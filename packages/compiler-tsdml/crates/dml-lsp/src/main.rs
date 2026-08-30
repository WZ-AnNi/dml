//! dml-lsp — a Language Server for DML / TSDML.
//!
//! Responsibility: give editors (VSCode via the client extension) rich DML
//! support by reusing the *same* Rust parser the compiler uses, so diagnostics
//! and the compiler agree. It is a thin JSON-RPC loop over `lsp-server`; all
//! language knowledge comes from `dml-parser` / `dml-ast`.
//!
//! Features:
//!   - diagnostics on open/change (parse errors with position + message)
//!   - hover on element names / attributes
//!   - semantic tokens (element, attribute, string, expression, number)
//!   - basic completion (element/attribute keywords)

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::str::FromStr;

use lsp_server::{Connection, Message, Notification, Request, Response};
use lsp_types::{
    CompletionItem, CompletionItemKind, CompletionParams, Diagnostic, DiagnosticSeverity,
    Hover, HoverContents, HoverParams, MarkupContent, MarkupKind, Position, PublishDiagnosticsParams,
    Range, SemanticToken, SemanticTokenType, SemanticTokens, SemanticTokensParams,
    SemanticTokensResult, ServerCapabilities, TextDocumentSyncCapability, TextDocumentSyncKind,
    TextDocumentSyncOptions, Uri,
};

use dml_parser::parse_document;

/// A document held by the server: its text and the last parse result.
struct Doc {
    text: String,
    /// parse error, if any
    error: Option<dml_parser::ParseError>,
}

fn main() {
    let (connection, io_threads) = Connection::stdio();
    let mut server = Server::new(connection);
    server.run();
    io_threads.join().unwrap();
}

struct Server {
    connection: Connection,
    docs: HashMap<String, Doc>,
}

impl Server {
    fn new(connection: Connection) -> Self {
        Self {
            connection,
            docs: HashMap::new(),
        }
    }

    fn run(&mut self) {
        loop {
            let msg = match self.connection.receiver.recv() {
                Ok(msg) => msg,
                Err(_) => break,
            };
            match msg {
                Message::Request(req) => {
                    match self.connection.handle_shutdown(&req) {
                        Ok(true) => return,
                        Ok(false) => self.handle_request(req),
                        Err(error) => {
                            eprintln!("shutdown protocol error: {error}");
                            return;
                        }
                    }
                }
                Message::Notification(not) => self.handle_notification(not),
                Message::Response(_) => {}
            }
        }
    }

    fn handle_request(&mut self, req: Request) {
        let id = req.id.clone();
        let result = match req.method.as_str() {
            "initialize" => self.initialize(&req),
            "textDocument/hover" => self.hover(&req),
            "textDocument/semanticTokens/full" => self.semantic_tokens(&req),
            "textDocument/completion" => self.completion(&req),
            _ => {
                // unknown request: respond with method-not-found
                let resp = Response::new_err(
                    id,
                    lsp_server::ErrorCode::MethodNotFound as i32,
                    format!("unhandled method {}", req.method),
                );
                self.connection.sender.send(Message::Response(resp)).unwrap();
                return;
            }
        };
        let resp = match result {
            Ok(value) => Response::new_ok(id, value),
            Err(e) => Response::new_err(id, lsp_server::ErrorCode::InternalError as i32, e),
        };
        self.connection.sender.send(Message::Response(resp)).unwrap();
    }

    fn handle_notification(&mut self, not: Notification) {
        match not.method.as_str() {
            "textDocument/didOpen" => {
                let params: lsp_types::DidOpenTextDocumentParams =
                    serde_json::from_value(not.params).unwrap();
                let uri = params.text_document.uri.to_string();
                self.docs.insert(
                    uri.clone(),
                    Doc {
                        text: params.text_document.text,
                        error: None,
                    },
                );
                self.publish_diagnostics(&uri);
            }
            "textDocument/didChange" => {
                let params: lsp_types::DidChangeTextDocumentParams =
                    serde_json::from_value(not.params).unwrap();
                let uri = params.text_document.uri.to_string();
                if let Some(doc) = self.docs.get_mut(&uri) {
                    // full sync: take the last change's text
                    if let Some(change) = params.content_changes.last() {
                        doc.text = change.text.clone();
                    }
                }
                self.publish_diagnostics(&uri);
            }
            "textDocument/didClose" => {
                let params: lsp_types::DidCloseTextDocumentParams =
                    serde_json::from_value(not.params).unwrap();
                self.docs.remove(&params.text_document.uri.to_string());
            }
            _ => {}
        }
    }

    fn initialize(&mut self, req: &Request) -> Result<serde_json::Value, String> {
        let _params: lsp_types::InitializeParams = serde_json::from_value(req.params.clone())
            .map_err(|e| format!("bad initialize params: {e}"))?;
        let caps = ServerCapabilities {
            text_document_sync: Some(TextDocumentSyncCapability::Options(
                TextDocumentSyncOptions {
                    open_close: Some(true),
                    change: Some(TextDocumentSyncKind::FULL),
                    ..Default::default()
                },
            )),
            hover_provider: Some(lsp_types::HoverProviderCapability::Simple(true)),
            semantic_tokens_provider: Some(
                lsp_types::SemanticTokensServerCapabilities::SemanticTokensOptions(
                    lsp_types::SemanticTokensOptions {
                        legend: lsp_types::SemanticTokensLegend {
                            token_types: vec![
                                SemanticTokenType::KEYWORD,
                                SemanticTokenType::STRING,
                                SemanticTokenType::NUMBER,
                                SemanticTokenType::FUNCTION,
                                SemanticTokenType::PROPERTY,
                            ],
                            token_modifiers: vec![],
                        },
                        full: Some(lsp_types::SemanticTokensFullOptions::Bool(true)),
                        ..Default::default()
                    },
                ),
            ),
            completion_provider: Some(lsp_types::CompletionOptions::default()),
            ..Default::default()
        };
        Ok(serde_json::to_value(lsp_types::InitializeResult {
            capabilities: caps,
            ..Default::default()
        })
        .unwrap())
    }

    fn publish_diagnostics(&mut self, uri: &str) {
        let mut diags = Vec::new();
        if let Some(doc) = self.docs.get(uri) {
            match parse_document(&doc.text) {
                Ok(_) => {}
                Err(e) => {
                    diags.push(Diagnostic {
                        range: Range {
                            start: Position {
                                line: e.span.line.saturating_sub(1),
                                character: e.span.col.saturating_sub(1),
                            },
                            end: Position {
                                line: e.span.line.saturating_sub(1),
                                character: e.span.col.saturating_sub(1) + 1,
                            },
                        },
                        severity: Some(DiagnosticSeverity::ERROR),
                        message: e.message.clone(),
                        ..Default::default()
                    });
                }
            }
        }
        let params = PublishDiagnosticsParams {
            uri: Uri::from_str(uri).unwrap(),
            diagnostics: diags,
            version: None,
        };
        let not = Notification::new(
            "textDocument/publishDiagnostics".to_string(),
            serde_json::to_value(params).unwrap(),
        );
        self.connection.sender.send(Message::Notification(not)).unwrap();
    }

    fn hover(&mut self, req: &Request) -> Result<serde_json::Value, String> {
        let params: HoverParams =
            serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
        let uri = params.text_document_position_params.text_document.uri.to_string();
        let pos = params.text_document_position_params.position;
        let doc = self.docs.get(&uri).ok_or("no open document")?;
        let line = doc.text.lines().nth(pos.line as usize).unwrap_or("");
        let word = word_at(line, pos.character as usize);
        let contents = HoverContents::Markup(MarkupContent {
            kind: MarkupKind::Markdown,
            value: format!("**`{word}`** — DML element/attribute\n\nParsed by the native Rust compiler."),
        });
        Ok(serde_json::to_value(Hover {
            contents,
            range: None,
        })
        .unwrap())
    }

    fn semantic_tokens(&mut self, req: &Request) -> Result<serde_json::Value, String> {
        let _params: SemanticTokensParams =
            serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
        // A minimal tokenizer: highlight element names, attributes, strings,
        // numbers and backtick expressions. Good enough for a first pass.
        let mut tokens = Vec::new();
        for doc in self.docs.values() {
            let mut prev_line = 0u32;
            let mut prev_char = 0u32;
            for (li, line) in doc.text.lines().enumerate() {
                let mut chars = line.char_indices().peekable();
                while let Some((ci, c)) = chars.next() {
                    let (ty, len) = match c {
                        '"' | '\'' => {
                            // string literal
                            let mut n = 1;
                            while let Some((_, cc)) = chars.next() {
                                n += 1;
                                if cc == c {
                                    break;
                                }
                            }
                            (SemanticTokenType::STRING, n)
                        }
                        '`' => {
                            let mut n = 1;
                            while let Some((_, cc)) = chars.next() {
                                n += 1;
                                if cc == '`' {
                                    break;
                                }
                            }
                            (SemanticTokenType::FUNCTION, n)
                        }
                        '@' => {
                            // attribute marker
                            let mut n = 1;
                            while let Some((_, cc)) = chars.peek() {
                                if cc.is_alphanumeric() || *cc == ':' || *cc == '-' {
                                    chars.next();
                                    n += 1;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::PROPERTY, n)
                        }
                        c if c.is_ascii_digit() => {
                            let mut n = 1;
                            while let Some((_, cc)) = chars.peek() {
                                if cc.is_ascii_digit() || *cc == '.' {
                                    chars.next();
                                    n += 1;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::NUMBER, n)
                        }
                        c if c.is_alphabetic() || c == '_' => {
                            // element name or bare word
                            let mut n = 1;
                            while let Some((_, cc)) = chars.peek() {
                                if cc.is_alphanumeric() || *cc == '-' || *cc == '_' {
                                    chars.next();
                                    n += 1;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::KEYWORD, n)
                        }
                        _ => continue,
                    };
                    let delta_line = li as u32 - prev_line;
                    let delta_char = if delta_line == 0 {
                        ci as u32 - prev_char
                    } else {
                        ci as u32
                    };
                    tokens.push(SemanticToken {
                        delta_line,
                        delta_start: delta_char,
                        length: len as u32,
                        token_type: token_type_index(&ty),
                        token_modifiers_bitset: 0,
                    });
                    prev_line = li as u32;
                    prev_char = ci as u32 + len as u32;
                }
            }
        }
        Ok(serde_json::to_value(SemanticTokensResult::Tokens(SemanticTokens {
            result_id: None,
            data: tokens,
        }))
        .unwrap())
    }

    fn completion(&mut self, req: &Request) -> Result<serde_json::Value, String> {
        let _params: CompletionParams =
            serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
        let items = vec![
            CompletionItem {
                label: "div".into(),
                kind: Some(CompletionItemKind::CLASS),
                detail: Some("DML element".into()),
                ..Default::default()
            },
            CompletionItem {
                label: "span".into(),
                kind: Some(CompletionItemKind::CLASS),
                detail: Some("DML element".into()),
                ..Default::default()
            },
            CompletionItem {
                label: "@class".into(),
                kind: Some(CompletionItemKind::PROPERTY),
                detail: Some("DML attribute".into()),
                ..Default::default()
            },
            CompletionItem {
                label: "@id".into(),
                kind: Some(CompletionItemKind::PROPERTY),
                detail: Some("DML attribute".into()),
                ..Default::default()
            },
        ];
        Ok(serde_json::to_value(lsp_types::CompletionResponse::Array(items)).unwrap())
    }
}

fn word_at(line: &str, col: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut start = col;
    let mut end = col;
    while start > 0 && chars.get(start - 1).map_or(false, |c| c.is_alphanumeric() || *c == '_' || *c == '-') {
        start -= 1;
    }
    while end < chars.len() && chars.get(end).map_or(false, |c| c.is_alphanumeric() || *c == '_' || *c == '-') {
        end += 1;
    }
    chars[start..end].iter().collect()
}

fn token_type_index(ty: &SemanticTokenType) -> u32 {
    match ty {
        t if t == &SemanticTokenType::KEYWORD => 0,
        t if t == &SemanticTokenType::STRING => 1,
        t if t == &SemanticTokenType::NUMBER => 2,
        t if t == &SemanticTokenType::FUNCTION => 3,
        t if t == &SemanticTokenType::PROPERTY => 4,
        _ => 0,
    }
}
