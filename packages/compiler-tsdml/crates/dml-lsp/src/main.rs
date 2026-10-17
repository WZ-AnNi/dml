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

/// A document held by the server: its text (parse errors are computed per
/// request via `dml_parser::parse_document`, which never fails).
struct Doc {
    text: String,
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
            let out = parse_document(&doc.text);
            for e in &out.errors {
                diags.push(Diagnostic {
                    range: error_range(&doc.text, e.span),
                    severity: Some(DiagnosticSeverity::ERROR),
                    message: e.message.clone(),
                    source: Some("dml".into()),
                    ..Default::default()
                });
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
        // numbers and backtick expressions. Comments are skipped entirely so
        // the textmate grammar (which colors them correctly) shows through.
        // Positions are emitted in UTF-16 code units as LSP requires: raw byte
        // offsets drift on every CJK character.
        let mut tokens = Vec::new();
        for doc in self.docs.values() {
            let mut prev_line = 0u32;
            let mut prev_char = 0u32;
            let mut in_block_comment = false;
            for (li, line) in doc.text.lines().enumerate() {
                let mut chars = line.char_indices().peekable();
                let mut u16_col = 0u32;
                while let Some((_ci, c)) = chars.next() {
                    if in_block_comment {
                        if c == '*' && chars.peek().map(|(_, cc)| *cc) == Some('/') {
                            chars.next();
                            u16_col += 2;
                            in_block_comment = false;
                        } else {
                            u16_col += c.len_utf16() as u32;
                        }
                        continue;
                    }
                    if c == '/' {
                        match chars.peek().map(|(_, cc)| *cc) {
                            Some('/') => break, // line comment: skip the rest of the line
                            Some('*') => {
                                chars.next();
                                u16_col += 2;
                                in_block_comment = true;
                                continue;
                            }
                            _ => {
                                u16_col += 1;
                                continue;
                            }
                        }
                    }
                    let start_u16 = u16_col;
                    let (ty, len) = match c {
                        '"' | '\'' => {
                            // string literal
                            let mut n = c.len_utf16() as u32;
                            while let Some((_, cc)) = chars.next() {
                                n += cc.len_utf16() as u32;
                                if cc == c {
                                    break;
                                }
                            }
                            (SemanticTokenType::STRING, n)
                        }
                        '`' => {
                            let mut n = 1u32;
                            while let Some((_, cc)) = chars.next() {
                                n += cc.len_utf16() as u32;
                                if cc == '`' {
                                    break;
                                }
                            }
                            (SemanticTokenType::FUNCTION, n)
                        }
                        '@' => {
                            // attribute marker
                            let mut n = 1u32;
                            while let Some((_, cc)) = chars.peek() {
                                let c2 = *cc;
                                if c2.is_alphanumeric() || c2 == ':' || c2 == '-' {
                                    chars.next();
                                    n += c2.len_utf16() as u32;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::PROPERTY, n)
                        }
                        c if c.is_ascii_digit() => {
                            let mut n = 1u32;
                            while let Some((_, cc)) = chars.peek() {
                                let c2 = *cc;
                                if c2.is_ascii_digit() || c2 == '.' {
                                    chars.next();
                                    n += c2.len_utf16() as u32;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::NUMBER, n)
                        }
                        c if c.is_alphabetic() || c == '_' => {
                            // element name or bare word
                            let mut n = c.len_utf16() as u32;
                            while let Some((_, cc)) = chars.peek() {
                                let c2 = *cc;
                                if c2.is_alphanumeric() || c2 == '-' || c2 == '_' {
                                    chars.next();
                                    n += c2.len_utf16() as u32;
                                } else {
                                    break;
                                }
                            }
                            (SemanticTokenType::KEYWORD, n)
                        }
                        _ => {
                            u16_col += c.len_utf16() as u32;
                            continue;
                        }
                    };
                    let delta_line = li as u32 - prev_line;
                    let delta_start = if delta_line == 0 {
                        start_u16 - prev_char
                    } else {
                        start_u16
                    };
                    tokens.push(SemanticToken {
                        delta_line,
                        delta_start,
                        length: len,
                        token_type: token_type_index(&ty),
                        token_modifiers_bitset: 0,
                    });
                    prev_line = li as u32;
                    prev_char = start_u16 + len;
                    u16_col = start_u16 + len;
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

/// Map one parser error span onto an LSP range.
///
/// Error spans are 0-based UTF-16 (LSP `Position` units), so they map straight
/// across. A span with byte width is widened to the offending construct; a
/// zero-width span squiggles one character so it stays visible. A caret at EOF
/// lands on the empty trailing line, so the range moves back to the last line
/// with content — LSP rejects a reversed or empty range.
fn error_range(text: &str, span: dml_ast::Span) -> Range {
    let mut start = Position {
        line: span.line,
        character: span.col,
    };
    let mut end = if span.end > span.start {
        let end = span.end.min(text.len());
        let before = &text[..end];
        let line = before.matches('\n').count() as u32;
        let col = if line == 0 {
            before.chars().map(|c| c.len_utf16() as u32).sum()
        } else {
            let last_nl = before.rfind('\n').unwrap_or(0);
            text[last_nl + 1..end]
                .chars()
                .map(|c| c.len_utf16() as u32)
                .sum()
        };
        Position {
            line,
            character: col,
        }
    } else {
        Position {
            line: start.line,
            character: start.character + 1,
        }
    };

    let lines: Vec<&str> = text.lines().collect();
    let empty_at = |l: u32| lines.get(l as usize).map_or(true, |s| s.is_empty());
    if empty_at(start.line) {
        let mut l = start.line as usize;
        while l > 0 && empty_at(l as u32) {
            l -= 1;
        }
        let len: u32 = lines
            .get(l)
            .map(|s| s.chars().map(|c| c.len_utf16() as u32).sum())
            .unwrap_or(0);
        start = Position {
            line: l as u32,
            character: len,
        };
        end = Position {
            line: l as u32,
            character: len + 1,
        };
    } else if end.line == start.line && end.character <= start.character {
        let len: u32 = lines[start.line as usize]
            .chars()
            .map(|c| c.len_utf16() as u32)
            .sum();
        end.character = (start.character + 1).min(len.max(1));
    }
    Range { start, end }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start: usize, end: usize, line: u32, col: u32) -> dml_ast::Span {
        dml_ast::Span {
            start,
            end,
            line,
            col,
        }
    }

    /// Every diagnostic the parser reports for `src` maps to a forward,
    /// non-empty range on a line that exists.
    fn all_ranges_are_valid(src: &str) {
        let out = parse_document(src);
        for e in &out.errors {
            let r = error_range(src, e.span);
            assert!(
                (r.end.line, r.end.character) > (r.start.line, r.start.character)
                    || r.end.line > r.start.line,
                "empty or reversed range for {:?}: {:?}",
                e.message,
                r
            );
            let line_count = src.lines().count() as u32;
            assert!(
                r.start.line < line_count.max(1),
                "range line {} past the last line {} for {:?}",
                r.start.line,
                line_count,
                e.message
            );
        }
    }

    #[test]
    fn error_at_span_keeps_its_line() {
        // Regression: `span_from_offsets` filled line/col with 0, so every
        // `err_at` diagnostic landed on line 1 regardless of where it was.
        let text = "div {\n  @class: )\n}\n";
        let out = parse_document(text);
        let with_width = out
            .errors
            .iter()
            .find(|e| e.span.end > e.span.start)
            .expect("expected a span with byte width");
        let r = error_range(text, with_width.span);
        assert_eq!(r.start.line, 1, "should point at the `@class` line");
        assert!(r.start.character > 0, "should not sit at column 0");
    }

    #[test]
    fn eof_error_is_visible_and_forward() {
        // The caret at EOF lands on the empty trailing line; the range must
        // move back to the last content line, not stay invisible at EOF.
        let text = "div {\n  span {\n";
        let out = parse_document(text);
        assert!(!out.errors.is_empty());
        for e in &out.errors {
            let r = error_range(text, e.span);
            assert!(
                r.end.line > r.start.line || r.end.character > r.start.character,
                "invisible range: {:?}",
                r
            );
            assert_eq!(r.start.line, 1, "should squiggle the last content line");
        }
    }

    #[test]
    fn utf16_columns_place_the_caret_where_the_editor_draws_it() {
        // `"中文😀"` — 4 chars, 2+2+2 UTF-16 units. A byte-based column would
        // land the caret mid-string.
        let text = "div { span { \"中文😀\" }, @class: ) }\n";
        let out = parse_document(text);
        let with_width = out
            .errors
            .iter()
            .find(|e| e.span.end > e.span.start)
            .expect("expected a span with byte width");
        let r = error_range(text, with_width.span);
        // the `)` is the 31st UTF-16 unit on line 0:
        // `div { span { "` (15) + `中文` (2) + `😀` (2) + `" }, @class: ` (12)
        assert_eq!(r.start.character, 31, "{:?}", r);
    }

    #[test]
    fn ranges_are_forward_for_many_inputs() {
        for src in [
            "div {",
            "div {\n  span {\n",
            "div { @class: ) }",
            "section {\n  span {\n    @class: )\n  }\n}\n",
            "div { span { \"中文😀\" }, @class: ) }\n",
            "@for (x of) { li {} }",
            "div { @if (a) { span {} ",
            "",
        ] {
            all_ranges_are_valid(src);
        }
    }
}
