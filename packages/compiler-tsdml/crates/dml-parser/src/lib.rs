//! dml-parser — a hand-written recursive-descent parser for DML.
//!
//! Responsibility: turn DML source text into a `dml_ast::Document`.
//! It does NOT know about TS, runtime calls, or code generation — those belong
//! to the codegen crate / TSDML layer. Kept error-tolerant and dependency-free
//! (only `dml-ast`).

use dml_ast::{DmlValue, Document, Element, Member, Span};

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

pub type Result<T> = std::result::Result<T, ParseError>;

struct Parser<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,
    line: u32,
    col: u32,
}

/// Parse a DML document (a root element). Trims surrounding whitespace.
pub fn parse_document(input: &str) -> Result<Document> {
    let mut p = Parser::new(input);
    let root = p.parse_element()?;
    p.skip_ws();
    if p.pos < p.bytes.len() {
        return Err(p.err("unexpected trailing content"));
    }
    Ok(Document { root })
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            src,
            bytes: src.as_bytes(),
            pos: 0,
            line: 1,
            col: 1,
        }
    }

    fn span(&self) -> Span {
        Span {
            start: self.pos,
            end: self.pos,
            line: self.line,
            col: self.col,
        }
    }

    fn err(&self, msg: &str) -> ParseError {
        ParseError {
            span: self.span(),
            message: msg.to_string(),
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek()?;
        self.pos += 1;
        if c == b'\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
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

    fn skip_ws(&mut self) {
        loop {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                self.bump();
            }
            // comments
            if self.peek() == Some(b'/') && self.bytes.get(self.pos + 1) == Some(&b'/') {
                while let Some(c) = self.peek() {
                    if c == b'\n' {
                        break;
                    }
                    self.bump();
                }
                continue;
            }
            if self.peek() == Some(b'/') && self.bytes.get(self.pos + 1) == Some(&b'*') {
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

    /// identifier: [A-Za-z_][A-Za-z0-9_\-]*
    fn parse_ident(&mut self) -> Result<String> {
        let start_span = self.span();
        let mut s = String::new();
        match self.peek() {
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => {
                s.push(c as char);
                self.bump();
            }
            _ => return Err(start_span.into_err("expected identifier")),
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'-' {
                s.push(c as char);
                self.bump();
            } else {
                break;
            }
        }
        Ok(s)
    }

    fn parse_element(&mut self) -> Result<Element> {
        let start_span = self.span();
        self.skip_ws();
        let name = if self.peek() == Some(b'@') {
            // allow a leading @ before element name? No — attributes belong in blocks.
            return Err(self.err("unexpected '@': expected element name"));
        } else {
            self.parse_ident()?
        };
        self.skip_ws();
        if !self.eat(b'{') {
            return Err(self.err("expected '{' to open element block"));
        }
        let members = self.parse_block_members()?;
        self.skip_ws();
        if !self.eat(b'}') {
            return Err(self.err("expected '}' to close element block"));
        }
        Ok(Element {
            name,
            members,
            span: Some(start_span),
        })
    }

    fn parse_block_members(&mut self) -> Result<Vec<Member>> {
        let mut members = Vec::new();
        loop {
            self.skip_ws();
            match self.peek() {
                None => return Err(self.err("unexpected end of input inside block")),
                Some(b'}') => break,
                Some(b'[') => {
                    self.bump();
                    let items = self.parse_sequence_content()?;
                    self.skip_ws();
                    if !self.eat(b']') {
                        return Err(self.err("expected ']' to close sequence"));
                    }
                    members.push(Member::Sequence(items));
                }
                Some(b'"') | Some(b'\'') => {
                    // A quoted string is either a text member, or — when followed
                    // by `:` — an attribute with a quoted name (e.g. "build:napi").
                    let s = self.parse_string()?;
                    self.skip_ws();
                    if self.peek() == Some(b':') {
                        self.bump();
                        self.skip_ws();
                        let value = self.parse_value()?;
                        members.push(Member::Attribute { name: s, value });
                    } else {
                        members.push(Member::Text(s));
                    }
                }
                Some(b'`') => {
                    // TSDML template expression child
                    let expr = self.parse_string()?;
                    members.push(Member::Expr(expr));
                }
                Some(_) => members.push(self.parse_member()?),
            }
            // consume an optional member separator (`,` or newline is allowed;
            // a bare comma between members is the common JSON-ish form)
            self.skip_ws();
            self.eat(b',');
        }
        Ok(members)
    }

    fn parse_member(&mut self) -> Result<Member> {
        self.skip_ws();
        if self.peek() == Some(b'@') {
            self.bump();
            let name = self.parse_ident()?;
            return self.finish_attribute(name);
        }
        // bare identifier: either a child element, or (inside a namespace scope)
        // a bare attribute `name: value` which the scope prefixes later.
        let name = self.parse_ident()?;
        self.skip_ws();
        match self.peek() {
            Some(b'{') => {
                let el = self.parse_element_from_name(name)?;
                Ok(Member::Element(el))
            }
            Some(b':') => {
                // bare attribute (namespace-scoped member)
                self.bump();
                self.skip_ws();
                let value = self.parse_value()?;
                Ok(Member::Attribute { name, value })
            }
            _ => Err(self.err("expected '{', ':' or '@' member")),
        }
    }

    fn parse_element_from_name(&mut self, name: String) -> Result<Element> {
        self.skip_ws();
        if !self.eat(b'{') {
            return Err(self.err("expected '{'"));
        }
        let members = self.parse_block_members()?;
        self.skip_ws();
        if !self.eat(b'}') {
            return Err(self.err("expected '}'"));
        }
        Ok(Element {
            name,
            members,
            span: Some(self.span()),
        })
    }

    fn finish_attribute(&mut self, name: String) -> Result<Member> {
        self.skip_ws();
        if !self.eat(b':') {
            return Err(self.err("expected ':' after attribute name"));
        }
        self.skip_ws();
        if self.peek() == Some(b'{') {
            // namespace scope
            self.bump();
            let inner = self.parse_block_members()?;
            self.skip_ws();
            if !self.eat(b'}') {
                return Err(self.err("expected '}' to close namespace scope"));
            }
            Ok(Member::NamespaceScope { prefix: name, inner })
        } else {
            let value = self.parse_value()?;
            Ok(Member::Attribute { name, value })
        }
    }

    fn parse_sequence_content(&mut self) -> Result<Vec<Member>> {
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            match self.peek() {
                None => return Err(self.err("unterminated sequence")),
                Some(b']') => break,
                Some(b'"') | Some(b'\'') => {
                    let t = self.parse_string()?;
                    items.push(Member::Text(t));
                }
                Some(b'`') => {
                    let expr = self.parse_string()?;
                    items.push(Member::Expr(expr));
                }
                _ => {
                    let m = self.parse_member()?;
                    items.push(m);
                }
            }
            self.skip_ws();
            self.eat(b',');
        }
        Ok(items)
    }

    fn parse_value(&mut self) -> Result<DmlValue> {
        self.skip_ws();
        match self.peek() {
            Some(b'"') | Some(b'\'') => Ok(DmlValue::String(self.parse_string()?)),
            Some(b'`') => {
                // TSDML template expression: backtick-quoted TS code, emitted verbatim
                let expr = self.parse_string()?;
                Ok(DmlValue::Expr(expr))
            }
            Some(b'[') => {
                self.bump();
                let mut v = Vec::new();
                loop {
                    self.skip_ws();
                    if self.peek() == Some(b']') {
                        self.bump();
                        break;
                    }
                    v.push(self.parse_value()?);
                    self.skip_ws();
                    self.eat(b',');
                }
                Ok(DmlValue::Array(v))
            }
            Some(b'{') => {
                self.bump();
                let mut pairs = Vec::new();
                loop {
                    self.skip_ws();
                    if self.peek() == Some(b'}') {
                        self.bump();
                        break;
                    }
                    let k = self.parse_ident()?;
                    self.skip_ws();
                    if !self.eat(b':') {
                        return Err(self.err("expected ':' in object"));
                    }
                    let val = self.parse_value()?;
                    pairs.push((k, val));
                    self.skip_ws();
                    self.eat(b',');
                }
                Ok(DmlValue::Object(pairs))
            }
            Some(c) if c.is_ascii_digit() || c == b'-' => self.parse_number(),
            Some(_) => {
                // bare identifier / bool / null
                let ident = self.parse_ident()?;
                Ok(match ident.as_str() {
                    "true" => DmlValue::Boolean(true),
                    "false" => DmlValue::Boolean(false),
                    "null" => DmlValue::Null,
                    _ => DmlValue::Bare(ident),
                })
            }
            None => Err(self.err("expected value")),
        }
    }

    fn parse_number(&mut self) -> Result<DmlValue> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.bump();
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || c == b'.' || c == b'e' || c == b'E' || c == b'+' || c == b'-') {
            self.bump();
        }
        let text = &self.src[start..self.pos];
        text.parse::<f64>()
            .map(DmlValue::Number)
            .map_err(|_| self.err("invalid number"))
    }

    fn parse_string(&mut self) -> Result<String> {
        let quote = self
            .bump()
            .ok_or_else(|| self.err("expected string"))?;
        let mut s = String::new();
        loop {
            match self.bump() {
                None => return Err(self.err("unterminated string")),
                Some(c) if c == quote => break,
                Some(b'\\') => match self.bump() {
                    Some(b'n') => s.push('\n'),
                    Some(b't') => s.push('\t'),
                    Some(b'r') => s.push('\r'),
                    Some(b'"') => s.push('"'),
                    Some(b'\'') => s.push('\''),
                    Some(b'\\') => s.push('\\'),
                    Some(b'`') => s.push('`'),
                    Some(other) => s.push(other as char),
                    None => return Err(self.err("unterminated escape")),
                },
                Some(c) => s.push(c as char),
            }
        }
        Ok(s)
    }
}

trait SpanErr {
    fn into_err(self, msg: &str) -> ParseError;
}
impl SpanErr for Span {
    fn into_err(self, msg: &str) -> ParseError {
        ParseError {
            span: self,
            message: msg.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_document;
    use dml_ast::{DmlValue, Member};

    #[test]
    fn parses_simple_element_with_attr() {
        let doc = parse_document(r#"circle { @cx: 50, @r: 40 }"#).unwrap();
        assert_eq!(doc.root.name, "circle");
        assert!(matches!(
            &doc.root.members[0],
            Member::Attribute { name, value: DmlValue::Number(_) } if name == "cx"
        ));
    }

    #[test]
    fn parses_nested_and_text() {
        let doc = parse_document(r#"p { "Hello", b { "world" } }"#).unwrap();
        assert_eq!(doc.root.members.len(), 2);
        assert!(matches!(&doc.root.members[0], Member::Text(t) if t == "Hello"));
        assert!(matches!(&doc.root.members[1], Member::Element(e) if e.name == "b"));
    }

    #[test]
    fn parses_sequence() {
        let doc = parse_document(r#"svg { [ rect { @x: 0 }, circle { @r: 1 } ] }"#).unwrap();
        assert!(matches!(&doc.root.members[0], Member::Sequence(items) if items.len() == 2));
    }

    #[test]
    fn parses_namespace_scope() {
        let doc = parse_document(
            r#"LinearLayout { @android: { layout_width: "match_parent" } }"#,
        )
        .unwrap();
        assert!(matches!(
            &doc.root.members[0],
            Member::NamespaceScope { prefix, .. } if prefix == "android"
        ));
    }

    #[test]
    fn reports_error_on_bad_input() {
        assert!(parse_document(r#"div {"#).is_err());
    }

    #[test]
    fn bare_and_boolean_values() {
        let doc = parse_document(r#"el { @a: none, @b: true }"#).unwrap();
        assert!(matches!(
            &doc.root.members[0],
            Member::Attribute { value: DmlValue::Bare(b), .. } if b == "none"
        ));
        assert!(matches!(
            &doc.root.members[1],
            Member::Attribute { value: DmlValue::Boolean(true), .. }
        ));
    }

    #[test]
    fn quoted_attribute_name() {
        let doc = parse_document(r#"tasks { "build:napi": "pnpm build" }"#).unwrap();
        assert!(matches!(
            &doc.root.members[0],
            Member::Attribute { name, value: DmlValue::String(v) }
                if name == "build:napi" && v == "pnpm build"
        ));
    }
}
