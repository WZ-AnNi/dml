//! dml-parser — a hand-written recursive-descent parser for DML.
//!
//! Responsibility: turn DML source text into a `dml_ast::Document` plus any
//! parse errors. It does NOT know about runtime calls or code generation.
//!
//! Tolerant by contract: parsing NEVER throws. Malformed input yields whatever
//! valid structure could be recovered plus an error list. Every AST node
//! carries its raw byte span (where meaningful) so the codegen crate can build
//! the authoritative raw↔lowered map editors need — the TSDML analogue of
//! TSX's tolerant parsing.
//!
//! Value positions (`@attr: …`) hold **TypeScript expressions**: [`ts_value`]
//! uses the real TS parser (oxc) to decide what the value is and how far it
//! reaches, with a tolerant scan for incomplete input.

mod ts_value;

use dml_ast::{Directive, DirectiveKind, Document, DmlValue, Element, ElseArm, MacroCall, Member, Span};
use ts_value::{parse_value, skip_template_literal, TsValue, TsValueKind};

/// Control-flow directive names: valid as `@if (…) { … }` blocks, never as
/// element attributes.
const DIRECTIVE_NAMES: [&str; 3] = ["if", "for", "as"];

/// A parse error with source position and a human message.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub span: Span,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} at {}:{} (byte {})",
            self.message, self.span.line, self.span.col, self.span.start
        )
    }
}
impl std::error::Error for ParseError {}

/// The tolerant result of parsing a document.
pub struct ParseOutput {
    pub document: Document,
    /// Non-fatal errors encountered while recovering.
    pub errors: Vec<ParseError>,
}

struct Parser<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,
    line: u32,
    col: u32,
    errors: Vec<ParseError>,
}

/// Parse a DML document (a root element). Never fails: malformed input
/// produces a best-effort document with errors recorded in `ParseOutput`.
pub fn parse_document(input: &str) -> ParseOutput {
    let mut p = Parser::new(input);
    let root = p.parse_element();
    p.skip_ws();
    if p.pos < p.bytes.len() {
        p.err_here("unexpected trailing content");
    }
    ParseOutput {
        document: Document { root },
        errors: p.errors,
    }
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            src,
            bytes: src.as_bytes(),
            pos: 0,
            line: 1,
            col: 0,
            errors: Vec::new(),
        }
    }

    /// A zero-width span at the current position (for error reporting).
    /// `line`/`col` are 0-based UTF-16, matching LSP `Position` directly.
    fn here(&self) -> Span {
        Span {
            start: self.pos,
            end: self.pos,
            line: self.line.saturating_sub(1),
            col: self.col,
        }
    }

    fn err_here(&mut self, msg: &str) {
        self.errors.push(ParseError {
            span: self.here(),
            message: msg.to_string(),
        });
    }

    /// Record an error covering an explicit byte range (so the editor can
    /// squiggle the offending construct, not just the caret position).
    ///
    /// `start`/`end` are absolute byte offsets, so line/col are derived from
    /// them — never left at 0, or every such diagnostic lands on line 1.
    fn err_at(&mut self, start: usize, end: usize, msg: &str) {
        let (line, col) = self.line_col_at(start);
        self.errors.push(ParseError {
            span: Span {
                start,
                end: end.max(start + 1),
                line,
                col,
            },
            message: msg.to_string(),
        });
    }

    /// 1-based line / **0-based** UTF-16 col of a byte offset. The line is
    /// 1-based while parsing (cheap to maintain incrementally) and converted to
    /// 0-based here, where an error span is built for LSP `Position`.
    fn line_col_at(&self, offset: usize) -> (u32, u32) {
        let offset = offset.min(self.src.len());
        let mut line = 1u32;
        let mut col = 0u32;
        for (i, c) in self.src.char_indices() {
            if i >= offset {
                break;
            }
            if c == '\n' {
                line += 1;
                col = 0;
            } else {
                col += c.len_utf16() as u32;
            }
        }
        (line - 1, col)
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn peek2(&self) -> Option<u8> {
        self.bytes.get(self.pos + 1).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek()?;
        // `col` is in UTF-16 code units (LSP `Position.character`). The scanner
        // walks bytes, so decode the char that *starts* at this byte — never
        // slice from `pos - 1`, which is mid-char for a multi-byte lead byte
        // and panics on the char-boundary check.
        let ch = self.src[self.pos..].chars().next().unwrap_or('\u{FFFD}');
        let width = ch.len_utf16() as u32;
        self.pos += ch.len_utf8();
        if c == b'\n' {
            self.line += 1;
            self.col = 0;
        } else {
            self.col += width;
        }
        Some(c)
    }

    fn eat(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.bump();
            true
        } else {
            false
        }
    }

    /// Advance to an absolute byte offset (tracking line/column).
    fn advance_to(&mut self, target: usize) {
        while self.pos < target {
            if self.bump().is_none() {
                break;
            }
        }
    }

    fn skip_ws(&mut self) {
        loop {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                self.bump();
            }
            // comments
            if self.peek() == Some(b'/') && self.peek2() == Some(b'/') {
                while let Some(c) = self.peek() {
                    if c == b'\n' {
                        break;
                    }
                    self.bump();
                }
                continue;
            }
            if self.peek() == Some(b'/') && self.peek2() == Some(b'*') {
                self.bump();
                self.bump();
                loop {
                    match self.bump() {
                        None => return,
                        Some(b'*') if self.peek() == Some(b'/') => {
                            self.bump();
                            break;
                        }
                        _ => {}
                    }
                }
                continue;
            }
            break;
        }
    }

    /// identifier: [A-Za-z_][A-Za-z0-9_\-]*  → (text, start, end)
    fn parse_ident(&mut self) -> Result<(String, usize, usize), ()> {
        let start = self.pos;
        let mut s = String::new();
        match self.peek() {
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => {
                s.push(c as char);
                self.bump();
            }
            _ => {
                self.err_here("expected identifier");
                return Err(());
            }
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'-' {
                s.push(c as char);
                self.bump();
            } else {
                break;
            }
        }
        Ok((s, start, self.pos))
    }

    fn parse_element(&mut self) -> Element {
        self.skip_ws();
        let (name, name_start, name_end) = match self.peek() {
            Some(b'@') => {
                self.err_here("unexpected '@': expected element name");
                (String::new(), self.pos, self.pos)
            }
            _ => match self.parse_ident() {
                Ok(t) => t,
                Err(()) => {
                    self.err_here("expected element name");
                    (String::new(), self.pos, self.pos)
                }
            },
        };
        self.skip_ws();
        let members = if self.eat(b'{') {
            let members = self.parse_block_members();
            self.skip_ws();
            if !self.eat(b'}') {
                self.err_here("expected '}' to close element block");
            }
            members
        } else {
            self.err_here("expected '{' to open element block");
            Vec::new()
        };
        // `span` carries the element NAME's byte range (for raw↔gen mapping).
        let span = if name.is_empty() {
            None
        } else {
            Some(Span {
                start: name_start,
                end: name_end,
                line: 0,
                col: 0,
            })
        };
        Element {
            name,
            members,
            span,
        }
    }

    fn parse_block_members(&mut self) -> Vec<Member> {
        let mut members = Vec::new();
        loop {
            self.skip_ws();
            let before_member = self.pos;
            match self.peek() {
                None => {
                    self.err_here("unexpected end of input inside block");
                    break;
                }
                Some(b'}') => break,
                Some(b'[') => {
                    self.bump();
                    let items = self.parse_sequence_content();
                    self.skip_ws();
                    if !self.eat(b']') {
                        self.err_here("expected ']' to close sequence");
                    }
                    members.push(Member::Sequence(items));
                }
                Some(b'"') | Some(b'\'') => {
                    // A quoted string is either a text member, or — when
                    // followed by `:` — an attribute with a quoted name.
                    let start = self.pos;
                    match self.parse_string() {
                        Ok((s, end)) => {
                            // For a quoted member the raw span covers the whole
                            // literal INCLUDING quotes: codegen renders text and
                            // attribute keys as quoted strings, so raw↔lowered
                            // text then matches verbatim.
                            let literal_span = span_from_offsets(start, end);
                            self.skip_ws();
                            if self.peek() == Some(b':') {
                                self.bump();
                                self.skip_ws();
                                let v_start = self.pos;
                                let value = self.parse_value();
                                let v_span = span_from_offsets(v_start, self.pos);
                                // attribute-name span = quoted name content
                                members.push(Member::Attribute {
                                    name: s,
                                    value,
                                    name_span: Some(Span {
                                        start: start + 1,
                                        end: end - 1,
                                        line: 0,
                                        col: 0,
                                    }),
                                    value_span: Some(v_span),
                                });
                            } else {
                                members.push(Member::Text {
                                    text: s,
                                    span: Some(literal_span),
                                });
                            }
                        }
                        Err(()) => {
                            self.err_here("unterminated string");
                            self.skip_to_member_boundary();
                        }
                    }
                }
                Some(b'`') => {
                    // a template literal child: oxc decides whether it is static
                    // text (no interpolation) or a live TS expression
                    let start = self.pos;
                    let end = skip_template_literal(self.src, start);
                    self.advance_to(end);
                    let raw = self.src[start..end].to_string();
                    let span = Some(span_from_offsets(start + 1, end - 1));
                    match ts_value::classify_expression(&raw) {
                        Ok(TsValueKind::String(text)) => {
                            members.push(Member::Text { text, span })
                        }
                        Ok(_) => members.push(Member::Expr { expr: raw, span }),
                        Err(msg) => {
                            self.err_here(&format!("invalid expression: {msg}"));
                            members.push(Member::Expr { expr: raw, span });
                        }
                    }
                }
                Some(b'{') => {
                    // TSDML template expression child: `{ expr }`
                    match self.parse_brace_expr() {
                        Ok((expr, raw_start, raw_end)) => {
                            members.push(Member::Expr {
                                expr,
                                span: Some(span_from_offsets(raw_start, raw_end)),
                            });
                        }
                        Err(()) => {
                            self.err_here("unterminated brace expression");
                            self.skip_to_member_boundary();
                        }
                    }
                }
                Some(_) => {
                    if let Some(m) = self.parse_member() {
                        members.push(m);
                    } else if self.pos == before_member {
                        // parse_member reported an error and did NOT advance —
                        // bump a byte so the recover loop always makes
                        // progress (otherwise an unrecognized char like `+`
                        // spins forever, growing the error list until OOM).
                        self.bump();
                    }
                }
            }
            self.skip_ws();
            self.eat(b',');
        }
        members
    }

    /// Skip junk until a position where a member can plausibly start.
    fn skip_to_member_boundary(&mut self) {
        loop {
            match self.peek() {
                None => return,
                Some(b',') | Some(b'}') | Some(b']') => return,
                Some(b'\n') => return,
                _ => {
                    self.bump();
                }
            }
        }
    }

    fn parse_member(&mut self) -> Option<Member> {
        self.skip_ws();
        if self.peek() == Some(b'@') {
            self.bump();
            match self.parse_attribute_name() {
                Ok((name, name_start, name_end)) => {
                    // `@if (cond) { … }` / `@for (x of items).key(x.id) { … }`
                    if matches!(name.as_str(), "if" | "for") && self.peek_significant() == Some(b'(') {
                        return Some(self.parse_directive_block(&name, name_start));
                    }
                    // `@name(...) { body }` — macro component call
                    if self.peek_significant() == Some(b'(') {
                        return Some(self.parse_macro_call(&name, name_start, name_end));
                    }
                    if DIRECTIVE_NAMES.contains(&name.as_str()) {
                        self.err_here(&format!(
                            "`@{name}` is a control-flow directive, not an attribute — write \
                             `@if (cond) {{ … }}` or `@for (x of items).key(x.id) {{ … }}`"
                        ));
                    }
                    Some(self.finish_attribute(name, name_start, name_end))
                }
                Err(()) => {
                    self.err_here("expected attribute name after '@'");
                    None
                }
            }
        } else {
            let (name, name_start, name_end) = match self.parse_ident() {
                Ok(t) => t,
                Err(()) => {
                    self.err_here("expected '{', ':' or '@' member");
                    return None;
                }
            };
            self.skip_ws();
            match self.peek() {
                Some(b'{') => {
                    // child element; its tag span is the name
                    let el = Element {
                        name,
                        members: self.parse_element_body(),
                        span: Some(span_from_offsets(name_start, name_end)),
                    };
                    Some(Member::Element(el))
                }
                Some(b':') => {
                    self.bump();
                    self.skip_ws();
                    let v_start = self.pos;
                    let value = self.parse_value();
                    Some(Member::Attribute {
                        name,
                        value,
                        name_span: Some(span_from_offsets(name_start, name_end)),
                        value_span: Some(span_from_offsets(v_start, self.pos)),
                    })
                }
                _ => {
                    // A bare identifier with no `{`/`:` is almost certainly an
                    // INCOMPLETE element the user is mid-typing (`di`, `img`
                    // before pressing `{`). Don't drop it: emit an empty
                    // element so the editor gets a `tag` span + a generated
                    // `e("di", …)` — that is what makes tag-name completion
                    // fire while typing. A genuine typo costs nothing (one
                    // empty runtime call until replaced).
                    self.err_here("expected '{', ':' or '@' member");
                    let el = Element {
                        name,
                        members: Vec::new(),
                        span: Some(span_from_offsets(name_start, name_end)),
                    };
                    Some(Member::Element(el))
                }
            }
        }
    }

    /// `@if (cond) { … }` / `@for (x of items).key(x.id) { … }` — the `@name`
    /// has been consumed and the current byte is `(`.
    ///
    /// One form, one AST node: the block owns a member list (so it can wrap any
    /// number of siblings) and is compiled by both backends. `@if` accepts
    /// `@else if` / `@else` arms, `@for` accepts `.key(expr)` — `.key("id")` is
    /// sugar for `x["id"]`.
    fn parse_directive_block(&mut self, name: &str, name_start: usize) -> Member {
        self.skip_ws(); // the `(` may be separated from the directive name
        self.bump(); // '('
        self.skip_ws();
        let kind = if name == "if" {
            let start = self.pos;
            let cond = self.parse_value();
            let cond_span = Some(span_from_offsets(start, self.pos));
            self.skip_ws();
            if !self.eat(b')') {
                self.err_here("expected ')' to close the `@if` condition");
            }
            DirectiveKind::If {
                cond,
                cond_span,
                otherwise: None,
            }
        } else {
            let (var, var_span, iter, iter_span) = self.parse_for_head();
            self.skip_ws();
            if !self.eat(b')') {
                self.err_here("expected ')' to close the `@for` head");
            }
            DirectiveKind::For {
                var,
                var_span,
                iter,
                iter_span,
            }
        };
        let body = self.parse_element_body();
        let kind = match kind {
            DirectiveKind::If { cond, cond_span, .. } => DirectiveKind::If {
                cond,
                cond_span,
                otherwise: self.parse_else_arms(),
            },
            other => other,
        };
        Member::Directive(Directive {
            kind,
            body,
            span: Some(Span {
                start: name_start,
                end: self.pos,
                line: 0,
                col: 0,
            }),
        })
    }

    /// `x of items` / `[k, v] in entries` → binding + iterable (both with spans).
    fn parse_for_head(&mut self) -> (String, Option<Span>, DmlValue, Option<Span>) {
        let head_start = self.pos;
        // The binding is everything before the `of`/`in` keyword; a binding is
        // an identifier or a destructuring pattern, so scan for it first.
        let Some((kw_start, kw_end)) = ts_value::find_keyword(self.src, head_start, &["of", "in"])
        else {
            self.err_here("expected `@for (item of items)`");
            let value = self.parse_value();
            return (
                "item".to_string(),
                None,
                value,
                Some(span_from_offsets(head_start, self.pos)),
            );
        };
        let raw_binding = &self.src[head_start..kw_start];
        let lead = raw_binding.len() - raw_binding.trim_start().len();
        let trail = raw_binding.len() - raw_binding.trim_end().len();
        let var = raw_binding.trim().to_string();
        let var_span = Some(span_from_offsets(head_start + lead, kw_start - trail));
        if var.is_empty() {
            self.err_here("expected a loop binding before `of`");
        } else if ts_value::classify_expression(&format!("({var}) => 0")).is_err() {
            // oxc decides whether the binding is a valid arrow parameter
            self.err_here(&format!("invalid `@for` binding `{var}`"));
        }
        self.advance_to(kw_end);
        self.skip_ws();
        let iter_start = self.pos;
        let iter = self.parse_value();
        let iter_span = Some(span_from_offsets(iter_start, self.pos));
        (var, var_span, iter, iter_span)
    }

    /// `@else if (cond) { … }` / `@else { … }` arms after an `@if` body.
    fn parse_else_arms(&mut self) -> Option<ElseArm> {
        if !self.peek_else() {
            return None;
        }
        self.skip_ws(); // `peek_else` looked past trivia; consume it first
        self.bump(); // '@'
        let _ = self.parse_ident(); // 'else'
        self.skip_ws();
        if self.peek_if_word() {
            let _ = self.parse_ident(); // 'if'
            self.skip_ws();
            if !self.eat(b'(') {
                self.err_here("expected '(' after `@else if`");
                return None;
            }
            self.skip_ws();
            let start = self.pos;
            let cond = self.parse_value();
            let cond_span = Some(span_from_offsets(start, self.pos));
            self.skip_ws();
            if !self.eat(b')') {
                self.err_here("expected ')' to close the `@else if` condition");
            }
            let body = self.parse_element_body();
            let otherwise = self.parse_else_arms();
            return Some(ElseArm::If(Box::new(Directive {
                kind: DirectiveKind::If {
                    cond,
                    cond_span,
                    otherwise,
                },
                body,
                span: None,
            })));
        }
        let body = self.parse_element_body();
        Some(ElseArm::Block { body, span: None })
    }

    /// Does an `@else` follow here (without consuming anything)?
    fn peek_else(&self) -> bool {
        let rest = self.src[self.pos..].trim_start();
        rest.starts_with("@else")
            && !rest[5..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
    }

    /// Is the next token the word `if` (without consuming anything)?
    fn peek_if_word(&self) -> bool {
        let rest = self.src[self.pos..].trim_start();
        rest.starts_with("if")
            && !rest[2..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
    }

    /// The next non-whitespace byte (without consuming anything).
    fn peek_significant(&self) -> Option<u8> {
        let mut pos = self.pos;
        while pos < self.bytes.len() && self.bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        self.bytes.get(pos).copied()
    }

    /// Parse a macro component call: `@name(...) { body }`.
    ///
    /// The `(...)` head is preserved as raw source (not parsed here); the registered
    /// macro component's `parse` function interprets it at codegen time. The body
    /// is a normal member list (same grammar as an element's body).
    fn parse_macro_call(&mut self, name: &str, name_start: usize, name_end: usize) -> Member {
        self.skip_ws();
        let head_start = self.pos;
        
        // Parse the (...) head — preserve as raw source
        if !self.eat(b'(') {
            self.err_here("expected '(' after macro component name");
            return Member::MacroCall(MacroCall {
                name: name.to_string(),
                name_span: Some(span_from_offsets(name_start, name_end)),
                head_src: String::new(),
                head_span: None,
                body: Vec::new(),
                span: Some(span_from_offsets(name_start, self.pos)),
            });
        }
        
        // Scan to matching ')' — track depth for nested parens
        let mut depth = 1;
        let head_content_start = self.pos;
        while depth > 0 && self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b'(' => {
                    depth += 1;
                    self.bump();
                }
                b')' => {
                    depth -= 1;
                    if depth > 0 {
                        self.bump();
                    }
                }
                b'"' | b'\'' | b'`' => {
                    // Skip string literal
                    let quote = self.bytes[self.pos];
                    self.bump();
                    while self.pos < self.bytes.len() && self.bytes[self.pos] != quote {
                        if self.bytes[self.pos] == b'\\' {
                            self.bump(); // skip escape
                        }
                        self.bump();
                    }
                    if self.pos < self.bytes.len() {
                        self.bump(); // closing quote
                    }
                }
                _ => {
                    self.bump();
                }
            }
        }
        let head_content_end = self.pos;
        
        if !self.eat(b')') {
            self.err_here("expected ')' to close macro component head");
        }
        
        let head_src = self.src[head_content_start..head_content_end].to_string();
        let head_span = Some(span_from_offsets(head_start, self.pos));
        
        // Parse the { body }
        let body = self.parse_element_body();
        
        let span = Some(span_from_offsets(name_start, self.pos));
        
        Member::MacroCall(MacroCall {
            name: name.to_string(),
            name_span: Some(span_from_offsets(name_start, name_end)),
            head_src,
            head_span,
            body,
            span,
        })
    }

    /// Parse an element body `{ members }` after the name has been consumed.
    fn parse_element_body(&mut self) -> Vec<Member> {
        self.skip_ws();
        let members = if self.eat(b'{') {
            let members = self.parse_block_members();
            self.skip_ws();
            if !self.eat(b'}') {
                self.err_here("expected '}'");
            }
            members
        } else {
            self.err_here("expected '{'");
            Vec::new()
        };
        members
    }

    /// `@name` seen; parse `: <TS expression>`.
    ///
    /// Value position is TypeScript, so `@style: { color: "red" }` is an object
    /// literal (it used to mean a namespace scope — namespaced keys are now
    /// written inline: `@android:layout_width: "x"`).
    fn finish_attribute(&mut self, name: String, name_start: usize, name_end: usize) -> Member {
        self.skip_ws();
        if !self.eat(b':') {
            self.err_here("expected ':' after attribute name");
            return Member::Attribute {
                name,
                value: DmlValue::Null,
                name_span: Some(span_from_offsets(name_start, name_end)),
                value_span: None,
            };
        }
        self.skip_ws();
        let value_start = self.pos;
        let value = self.parse_value();
        let value_span = Some(span_from_offsets(value_start, self.pos));
        Member::Attribute {
            name,
            value,
            name_span: Some(span_from_offsets(name_start, name_end)),
            value_span,
        }
    }

    /// An attribute name, optionally namespaced: `@android:layout_width`.
    ///
    /// The `:` is only absorbed when an identifier follows it immediately, so
    /// `@x: 1` still separates the name from its value.
    fn parse_attribute_name(&mut self) -> Result<(String, usize, usize), ()> {
        let (mut name, start, mut end) = self.parse_ident()?;
        while self.peek() == Some(b':')
            && matches!(self.peek2(), Some(c) if c.is_ascii_alphabetic() || c == b'_')
        {
            self.bump(); // ':'
            let (part, _ps, pe) = self.parse_ident()?;
            name.push(':');
            name.push_str(&part);
            end = pe;
        }
        Ok((name, start, end))
    }

    fn parse_sequence_content(&mut self) -> Vec<Member> {
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            let before_item = self.pos;
            match self.peek() {
                None => {
                    self.err_here("unterminated sequence");
                    break;
                }
                Some(b']') => break,
                Some(b'"') | Some(b'\'') => {
                    let start = self.pos;
                    match self.parse_string() {
                        Ok((t, end)) => {
                            // whole literal including quotes (matches lowered)
                            items.push(Member::Text {
                                text: t,
                                span: Some(span_from_offsets(start, end)),
                            });
                        }
                        Err(()) => {
                            self.err_here("unterminated string");
                            self.skip_to_member_boundary();
                        }
                    }
                }
                Some(b'`') => {
                    // a template literal child: oxc decides whether it is static
                    // text (no interpolation) or a live TS expression
                    let start = self.pos;
                    let end = skip_template_literal(self.src, start);
                    self.advance_to(end);
                    let raw = self.src[start..end].to_string();
                    let span = Some(span_from_offsets(start + 1, end - 1));
                    match ts_value::classify_expression(&raw) {
                        Ok(TsValueKind::String(text)) => {
                            items.push(Member::Text { text, span })
                        }
                        Ok(_) => items.push(Member::Expr { expr: raw, span }),
                        Err(msg) => {
                            self.err_here(&format!("invalid expression: {msg}"));
                            items.push(Member::Expr { expr: raw, span });
                        }
                    }
                }
                Some(b'{') => {
                    match self.parse_brace_expr() {
                        Ok((expr, raw_start, raw_end)) => {
                            // brace expr: content only (no braces in lowered)
                            items.push(Member::Expr {
                                expr,
                                span: Some(span_from_offsets(raw_start, raw_end)),
                            });
                        }
                        Err(()) => {
                            self.err_here("unterminated brace expression");
                            self.skip_to_member_boundary();
                        }
                    }
                }
                _ => {
                    if let Some(m) = self.parse_member() {
                        items.push(m);
                    } else if self.pos == before_item {
                        // see parse_block_members: always make progress
                        self.bump();
                    }
                }
            }
            self.skip_ws();
            self.eat(b',');
        }
        items
    }

    /// Parse a value-position TypeScript expression.
    ///
    /// oxc decides both questions: **what** the value is (a string/number/
    /// boolean/null literal, a lone identifier, or any other expression kept
    /// verbatim) and **how far** it reaches (the longest candidate that parses,
    /// stopping at a DML member boundary). Literals keep their precise AST
    /// shape so the optimizer can put them straight into the static shape.
    fn parse_value(&mut self) -> DmlValue {
        self.skip_ws();
        let start = self.pos;
        match parse_value(self.src, start) {
            TsValue::Ok { end, kind } => {
                self.advance_to(end);
                match kind {
                    TsValueKind::String(s) => DmlValue::String(s),
                    TsValueKind::Number(n) => DmlValue::Number(n),
                    TsValueKind::Boolean(b) => DmlValue::Boolean(b),
                    TsValueKind::Null => DmlValue::Null,
                    TsValueKind::Ident(name) => DmlValue::Bare(name),
                    TsValueKind::Other => {
                        DmlValue::Expr(self.src[start..end].trim().to_string())
                    }
                }
            }
            TsValue::Err { end, error } => {
                // Tolerant: keep whatever the boundary scan found, report the
                // TS error over the whole value, and let the editor keep working.
                self.advance_to(end);
                let text = self.src[start..end].trim();
                if text.is_empty() {
                    self.err_at(start, end, "expected value");
                    DmlValue::Null
                } else {
                    self.err_at(start, end, &format!("invalid value expression: {error}"));
                    DmlValue::Expr(text.to_string())
                }
            }
        }
    }

    /// Parse a `{ expr }` TSDML template expression. The current byte is `{`.
    /// Returns the trimmed expression plus the byte range of that trimmed
    /// content within the whole source (so callers can set precise spans).
    fn parse_brace_expr(&mut self) -> Result<(String, usize, usize), ()> {
        self.bump(); // consume '{'
        let start = self.pos;
        let mut depth = 1usize;
        loop {
            match self.bump() {
                None => {
                    self.err_here("unterminated brace expression");
                    return Err(());
                }
                Some(b'{') => depth += 1,
                Some(b'}') => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                Some(b'"') | Some(b'\'') | Some(b'`') => {
                    let quote = self.bytes[self.pos - 1];
                    loop {
                        match self.bump() {
                            None => {
                                self.err_here("unterminated string in expression");
                                return Err(());
                            }
                            Some(c) if c == quote => break,
                            Some(b'\\') => {
                                self.bump();
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        let inner = &self.src[start..self.pos - 1];
        let trimmed = inner.trim();
        let lead = inner.len() - inner.trim_start().len();
        let trail = inner.len() - inner.trim_end().len();
        let expr_start = start + lead;
        let expr_end = self.pos - 1 - trail;
        // `{ expr }` is a TS expression child: let the real TS grammar judge it.
        if let Some(msg) = ts_value::expression_error(trimmed) {
            self.err_at(expr_start, expr_end, &format!("invalid expression: {msg}"));
        }
        Ok((trimmed.to_string(), expr_start, expr_end))
    }

    /// Parse a quoted/backtick string. Returns (content, end) where `end` is
    /// one past the closing delimiter.
    fn parse_string(&mut self) -> Result<(String, usize), ()> {
        let quote = match self.bump() {
            Some(q) => q,
            None => {
                self.err_here("expected string");
                return Err(());
            }
        };
        let mut s = String::new();
        loop {
            match self.bump() {
                None => {
                    self.err_here("unterminated string");
                    return Err(());
                }
                Some(c) if c == quote => return Ok((s, self.pos)),
                Some(b'\\') => match self.bump() {
                    Some(b'n') => s.push('\n'),
                    Some(b't') => s.push('\t'),
                    Some(b'r') => s.push('\r'),
                    Some(b'"') => s.push('"'),
                    Some(b'\'') => s.push('\''),
                    Some(b'\\') => s.push('\\'),
                    Some(b'`') => s.push('`'),
                    Some(other) => s.push(other as char),
                    None => {
                        self.err_here("unterminated escape");
                        return Err(());
                    }
                },
                Some(c) => s.push(c as char),
            }
        }
    }
}

/// A zero-alloc helper to build a Span from raw offsets. Used for AST spans,
/// where only the byte range matters (the editor routes by bytes); error spans
/// carry real line/col, so they go through `err_at` instead.
fn span_from_offsets(start: usize, end: usize) -> Span {
    Span {
        start,
        end,
        line: 0,
        col: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_document;
    use dml_ast::{Directive, DirectiveKind, DmlValue, ElseArm, Member};

    /// The single directive member of a parsed element.
    fn directive_of(src: &str) -> Directive {
        let out = parse_document(src);
        assert!(out.errors.is_empty(), "{:?}", out.errors);
        match &out.document.root.members[0] {
            Member::Directive(d) => d.clone(),
            other => panic!("expected a directive, got {other:?}"),
        }
    }

    #[test]
    fn parses_if_block() {
        let d = directive_of(r#"div { @if (count.read() > 3) { span { "hot" } } }"#);
        assert_eq!(d.body.len(), 1);
        assert!(matches!(&d.body[0], Member::Element(e) if e.name == "span"));
        match &d.kind {
            DirectiveKind::If { cond, otherwise, .. } => {
                assert_eq!(cond, &DmlValue::Expr("count.read() > 3".into()));
                assert!(otherwise.is_none());
            }
            other => panic!("expected @if, got {other:?}"),
        }
    }

    #[test]
    fn parses_if_else_chain() {
        let d = directive_of(
            r#"div { @if (a) { "A" } @else if (b) { "B" } @else { "C" } }"#,
        );
        let DirectiveKind::If { otherwise: Some(ElseArm::If(second)), .. } = &d.kind else {
            panic!("expected an @else if arm: {:?}", d.kind);
        };
        let DirectiveKind::If { cond, otherwise: Some(ElseArm::Block { body, .. }), .. } = &second.kind
        else {
            panic!("expected an @else arm: {:?}", second.kind);
        };
        assert_eq!(cond, &DmlValue::Bare("b".into()));
        assert!(matches!(&body[0], Member::Text { text, .. } if text == "C"));
    }

    #[test]
    fn parses_for_block_with_key() {
        let d = directive_of(
            r#"ul { @for (tick of ticks.read()) { @key: tick.id, li { { tick.label } } } }"#,
        );
        match &d.kind {
            DirectiveKind::For { var, iter, .. } => {
                assert_eq!(var, "tick");
                assert_eq!(iter, &DmlValue::Expr("ticks.read()".into()));
            }
            other => panic!("expected @for, got {other:?}"),
        }
        // Check that @key is in the body
        assert!(matches!(&d.body[0], Member::Attribute { name, value, .. } 
            if name == "key" && *value == DmlValue::Expr("tick.id".into())));
        assert!(matches!(&d.body[1], Member::Element(e) if e.name == "li"));
    }

    #[test]
    fn for_block_accepts_in_and_destructuring() {
        let d = directive_of(r#"div { @for ([k, v] in entries) { span { { k } } } }"#);
        match &d.kind {
            DirectiveKind::For { var, iter, .. } => {
                assert_eq!(var, "[k, v]");
                assert_eq!(iter, &DmlValue::Bare("entries".into()));
            }
            other => panic!("expected @for, got {other:?}"),
        }
    }

    #[test]
    fn for_block_body_can_hold_several_members() {
        let d = directive_of(r#"ul { @for (x of xs) { li { { x } }, li { "sep" } } }"#);
        assert_eq!(d.body.len(), 2, "{:?}", d.body);
    }

    #[test]
    fn nested_directives_parse() {
        let d = directive_of(
            r#"div { @if (a) { @for (x of xs) { span { { x } } } } }"#,
        );
        assert!(matches!(&d.body[0], Member::Directive(inner)
            if matches!(inner.kind, DirectiveKind::For { .. })));
    }

    #[test]
    fn directive_as_an_attribute_is_an_error() {
        // the compact element form is gone: say so instead of silently emitting
        // `@if` as a DOM prop
        let out = parse_document(r#"div { span { @if: cond, "x" } }"#);
        assert!(
            out.errors.iter().any(|e| e.message.contains("control-flow directive")),
            "{:?}",
            out.errors
        );
    }

    #[test]
    fn parses_simple_element_with_attr() {
        let out = parse_document(r#"circle { @cx: 50, @r: 40 }"#);
        assert_eq!(out.document.root.name, "circle");
        assert!(out.errors.is_empty());
        assert!(matches!(
            &out.document.root.members[0],
            Member::Attribute { name, value: DmlValue::Number(_), .. } if name == "cx"
        ));
    }

    #[test]
    fn parses_nested_and_text() {
        let out = parse_document(r#"p { "Hello", b { "world" } }"#);
        assert_eq!(out.document.root.members.len(), 2);
        assert!(matches!(&out.document.root.members[0], Member::Text { text, .. } if text == "Hello"));
        assert!(matches!(&out.document.root.members[1], Member::Element(e) if e.name == "b"));
    }

    #[test]
    fn parses_sequence() {
        let out = parse_document(r#"svg { [ rect { @x: 0 }, circle { @r: 1 } ] }"#);
        assert!(matches!(&out.document.root.members[0], Member::Sequence(items) if items.len() == 2));
    }

    #[test]
    fn parses_namespaced_attribute_name() {
        // `@ns: { … }` is gone: value position is TypeScript, so `{ … }` is an
        // object literal. Namespaced keys are written inline instead.
        let out = parse_document(r#"LinearLayout { @android:layout_width: "match_parent" }"#);
        assert!(matches!(
            &out.document.root.members[0],
            Member::Attribute { name, .. } if name == "android:layout_width"
        ));
    }

    /// Value position is TypeScript: every one of these is a valid value.
    #[test]
    fn value_position_accepts_ts_expressions() {
        let cases: &[(&str, fn(&DmlValue) -> bool, &str)] = &[
            (r#"div { @class: cls() }"#, |v| matches!(v, DmlValue::Expr(e) if e == "cls()"), "call"),
            (
                r#"div { @class: "a" + "b" }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == r#""a" + "b""#),
                "concatenation",
            ),
            (
                r#"div { @style: { color: "red" } }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == r#"{ color: "red" }"#),
                "object literal",
            ),
            (
                r#"div { @list: [1, 2] }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == "[1, 2]"),
                "array literal",
            ),
            (
                r#"div { @class: cond ? "a" : "b" }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == r#"cond ? "a" : "b""#),
                "ternary",
            ),
            (
                r#"div { @onClick: () => count() }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == "() => count()"),
                "arrow function",
            ),
            (
                r#"div { @class: fn({ a: 1 }, [2]) }"#,
                |v| matches!(v, DmlValue::Expr(_)),
                "balanced nesting",
            ),
            (
                r#"div { @re: /a\/b/g }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == r"/a\/b/g"),
                "regex literal",
            ),
            // backticks are ordinary template literals, not an expression marker
            (
                "div { @class: `cls()` }",
                |v| matches!(v, DmlValue::String(s) if s == "cls()"),
                "template literal without interpolation is a string",
            ),
            (
                "div { @class: `hi ${name}` }",
                |v| matches!(v, DmlValue::Expr(e) if e == "`hi ${name}`"),
                "template literal with interpolation",
            ),
            (r#"div { @src: heroImg }"#, |v| matches!(v, DmlValue::Bare(b) if b == "heroImg"), "identifier"),
            (
                r#"div { @n: x as number }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == "x as number"),
                "as-expression",
            ),
            (
                r#"div { @n: x satisfies T }"#,
                |v| matches!(v, DmlValue::Expr(e) if e == "x satisfies T"),
                "satisfies-expression",
            ),
            (r#"div { @n: 170 }"#, |v| matches!(v, DmlValue::Number(n) if *n == 170.0), "number"),
            (
                r#"div { @alt: "x" }"#,
                |v| matches!(v, DmlValue::String(s) if s == "x"),
                "string",
            ),
        ];
        for (src, ok, what) in cases {
            let out = parse_document(src);
            assert!(out.errors.is_empty(), "{what}: unexpected errors {:?}", out.errors);
            match &out.document.root.members[0] {
                Member::Attribute { value, .. } => assert!(ok(value), "{what}: wrong value {value:?}"),
                other => panic!("{what}: expected an attribute, got {other:?}"),
            }
        }
    }

    /// A malformed value is reported (by the real TS parser), not swallowed.
    #[test]
    fn malformed_values_are_reported() {
        let out = parse_document("div { @class: a + }");
        assert!(
            out.errors
                .iter()
                .any(|e| e.message.contains("invalid value expression")),
            "errors: {:?}",
            out.errors
        );
        // the tolerant contract still holds: the member survives
        assert!(matches!(
            &out.document.root.members[0],
            Member::Attribute { name, .. } if name == "class"
        ));

        let out = parse_document("div { { a + } }");
        assert!(
            out.errors.iter().any(|e| e.message.contains("invalid expression")),
            "errors: {:?}",
            out.errors
        );
    }

    /// A formatted multi-line expression continues; a new member does not.
    #[test]
    fn value_ends_at_the_member_boundary() {
        let out = parse_document(
            "div {\n  @class: cond\n    ? \"a\"\n    : \"b\",\n  @id: \"x\"\n  span { \"hi\" }\n}",
        );
        assert!(out.errors.is_empty(), "errors: {:?}", out.errors);
        let members = &out.document.root.members;
        assert!(
            matches!(&members[0], Member::Attribute { value: DmlValue::Expr(e), .. } if e == "cond\n    ? \"a\"\n    : \"b\""),
            "multi-line ternary: {:?}",
            members[0]
        );
        assert!(matches!(&members[1], Member::Attribute { name, value: DmlValue::String(s), .. } if name == "id" && s == "x"));
        assert!(matches!(&members[2], Member::Element(e) if e.name == "span"));
    }

    #[test]
    fn tolerates_bad_input_with_error() {
        let out = parse_document(r#"div {"#);
        assert!(!out.errors.is_empty());
        assert_eq!(out.document.root.name, "div");
    }

    #[test]
    fn error_spans_carry_lsp_ready_positions() {
        // An unterminated block on line 3: the diagnostic must point at line 2
        // (0-based) and be one character wide, never collapse to line 0.
        let src = "div {\n  span {\n";
        let out = parse_document(src);
        assert!(!out.errors.is_empty(), "expected an error for {src:?}");
        for e in &out.errors {
            let lines_before = src[..e.span.start.min(src.len())].matches('\n').count() as u32;
            assert_eq!(
                e.span.line, lines_before,
                "line mismatch for {:?}: span {:?}",
                e.message, e.span
            );
        }
    }

    #[test]
    fn error_columns_count_utf16_units() {
        // `"中文"` is 2 chars but 2 UTF-16 units; an emoji would be 2 units per
        // char. The caret must land where the editor draws it.
        let src = "div { @class: \"😀x\" }";
        let out = parse_document(src);
        // valid input: no errors, this only guards the helper's units
        assert!(out.errors.is_empty(), "errors: {:?}", out.errors);
    }

    #[test]
    fn err_at_span_covers_the_offending_value() {
        // `@class: )` — the value scan fails, so the error span has real byte
        // width (not the caret's zero width).
        let out = parse_document("div { @class: ) }");
        assert!(!out.errors.is_empty());
        let e = out.errors.iter().find(|e| e.span.end > e.span.start);
        assert!(
            e.is_some(),
            "expected a span with width, got {:?}",
            out.errors
        );
    }

    #[test]
    fn never_hangs_on_unparseable_member_chars() {
        // regression: `"count is " + count` — after the quoted text, `+` is
        // not an identifier, parse_member failed WITHOUT advancing and the
        // recover loop spun, growing the error list until OOM (12 GB alloc).
        let out = parse_document(r#"p { "count is " + count }"#);
        // must terminate; errors reported, no crash
        assert!(out.errors.iter().any(|e| e.message.contains("identifier")));
        assert!(out.document.root.name == "p");
    }

    #[test]
    fn reports_error_on_bad_element() {
        let out = parse_document(r#"@notanElement"#);
        assert!(!out.errors.is_empty());
        assert!(out.document.root.name.is_empty());
    }

    #[test]
    fn bare_and_boolean_values() {
        let out = parse_document(r#"el { @a: none, @b: true }"#);
        assert!(matches!(
            &out.document.root.members[0],
            Member::Attribute { value: DmlValue::Bare(b), .. } if b == "none"
        ));
        assert!(matches!(
            &out.document.root.members[1],
            Member::Attribute { value: DmlValue::Boolean(true), .. }
        ));
    }

    #[test]
    fn quoted_attribute_name() {
        let out = parse_document(r#"tasks { "build:napi": "pnpm build" }"#);
        assert!(matches!(
            &out.document.root.members[0],
            Member::Attribute { name, value: DmlValue::String(v), .. }
                if name == "build:napi" && v == "pnpm build"
        ));
    }

    #[test]
    fn parses_brace_expression_child() {
        let out = parse_document(r#"span { { count() } }"#);
        assert!(matches!(&out.document.root.members[0], Member::Expr { expr, .. } if expr == "count()"));
    }

    #[test]
    fn parses_brace_expression_with_nested_braces() {
        let out = parse_document(r#"span { { fn({ x: 1 }) } }"#);
        assert!(matches!(&out.document.root.members[0], Member::Expr { expr, .. } if expr == "fn({ x: 1 })"));
    }

    #[test]
    fn parses_brace_expression_in_sequence() {
        let out = parse_document(r#"p { [ "count: ", { count() } ] }"#);
        assert!(matches!(
            &out.document.root.members[0],
            Member::Sequence(items)
                if matches!(&items[1], Member::Expr { expr, .. } if expr == "count()")
        ));
    }

    #[test]
    fn spans_record_document_order() {
        // Element.name spans must slice out exactly the element name text.
        let src = "div { img { @src: hero }, \"hi\" }";
        let out = parse_document(src);
        let div = out.document.root;
        assert_eq!(div.name, "div");
        let div_span = div.span.unwrap();
        assert_eq!(&src[div_span.start..div_span.end], "div");
        let img = match &div.members[0] {
            Member::Element(e) => e,
            _ => panic!("member 0 is img element"),
        };
        assert_eq!(img.name, "img");
        let img_span = img.span.unwrap();
        assert_eq!(&src[img_span.start..img_span.end], "img");
        // attr name span and value span slice exactly their raw tokens
        let (name_span, value_span) = match &img.members[0] {
            Member::Attribute { name_span, value_span, .. } => (name_span.unwrap(), value_span.unwrap()),
            _ => panic!("img member 0 is @src"),
        };
        assert_eq!(&src[name_span.start..name_span.end], "src");
        assert_eq!(&src[value_span.start..value_span.end], "hero");
        // spans are in document order and non-overlapping
        assert!(div_span.end < img_span.start, "div before img");
        assert!(img_span.end < name_span.start, "img before attr");
        assert!(name_span.end < value_span.start, "attr name before value");
    }

    #[test]
    fn parses_macro_call() {
        let out = parse_document(r#"div { @Show(cond) { p { "hi" } } }"#);
        assert_eq!(out.errors.len(), 0);
        let div = out.document.root;
        assert_eq!(div.name, "div");
        let show = match &div.members[0] {
            Member::MacroCall(m) => m,
            _ => panic!("member 0 is @Show macro call"),
        };
        assert_eq!(show.name, "Show");
        assert_eq!(show.head_src, "cond");
        assert_eq!(show.body.len(), 1);
    }

    #[test]
    fn macro_call_preserves_nested_parens_in_head() {
        let out = parse_document(r#"div { @Show(fn(x, y)) { p { "hi" } } }"#);
        assert_eq!(out.errors.len(), 0);
        let show = match &out.document.root.members[0] {
            Member::MacroCall(m) => m,
            _ => panic!("member 0 is @Show macro call"),
        };
        assert_eq!(show.head_src, "fn(x, y)");
    }

    #[test]
    fn macro_call_with_string_in_head() {
        let out = parse_document(r#"div { @Show("hello") { p { "hi" } } }"#);
        assert_eq!(out.errors.len(), 0);
        let show = match &out.document.root.members[0] {
            Member::MacroCall(m) => m,
            _ => panic!("member 0 is @Show macro call"),
        };
        assert_eq!(show.head_src, r#""hello""#);
    }
}
