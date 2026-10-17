//! Value-position TypeScript, decided by the real TS parser (oxc).
//!
//! A DML value (`@attr: <here>`) is a TypeScript expression. Two questions, and
//! oxc answers both:
//!
//! **What is it?** The expression is parsed with `oxc_parser`, and the AST node
//! kind classifies it: a string/number/boolean/null literal, a lone identifier
//! (a compile-time reference), or "some other expression" (kept verbatim). No
//! hand-written literal scanner, no escape handling — oxc does string decoding,
//! template cooking and number parsing.
//!
//! **How far does it reach?** TypeScript expressions end at a `,` in *list
//! position (an array element, a call argument), and DML members may also be
//! newline-separated — so `(a, b)` is the comma operator while `a, b` is two
//! members. The DML boundary scanner below finds candidate boundaries; oxc then
//! picks the **longest candidate that is a valid expression** (maximal munch),
//! which is what makes `x as number`, `x satisfies T`, `x instanceof Y` and
//! `k in obj` work without any keyword list: `x` parses, `x as number` parses
//! and is longer, `x as number @b` does not — so `x as number` wins.
//!
//! A comma (or the closing `}`) is a hard boundary: the DSL owns it.

use oxc_allocator::Allocator;
use oxc_ast::ast::Expression;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// How many candidate boundaries the maximal munch may try (values spanning
/// more than a couple of DML segments are pathological).
const MAX_CANDIDATES: usize = 4;

/// What a value-position expression turned out to be.
#[derive(Debug, Clone, PartialEq)]
pub enum TsValueKind {
    /// `"text"` / `` `text` `` (already unescaped/unquoted).
    String(String),
    /// `170`
    Number(f64),
    Boolean(bool),
    Null,
    /// A bare identifier (`heroImg`): a compile-time reference.
    Ident(String),
    /// Anything else, kept verbatim.
    Other,
}

/// The outcome of parsing a value position.
#[derive(Debug, Clone, PartialEq)]
pub enum TsValue {
    /// A valid expression ending at this byte offset.
    Ok { end: usize, kind: TsValueKind },
    /// Nothing at this position parses as a TypeScript expression: `end` is the
    /// tolerant segment boundary and `error` is oxc's message. The caller keeps
    /// the text verbatim and reports the error.
    Err { end: usize, error: String },
}

/// Parse the value-position expression starting at `start`.
pub fn parse_value(src: &str, start: usize) -> TsValue {
    let mut best: Option<(usize, TsValueKind)> = None;
    let mut first_error: Option<String> = None;
    let mut cursor = start;
    for _ in 0..MAX_CANDIDATES {
        let end = segment_end(src, cursor);
        let text = src[start..end].trim();
        if text.is_empty() {
            break;
        }
        match parse_expression(text) {
            Ok(kind) => {
                best = Some((end, kind));
                // A comma (or the end of the block) is a DML member boundary:
                // never extend across it.
                if matches!(significant_byte(src, end), Some(b',') | Some(b'}') | None) {
                    break;
                }
                cursor = end;
            }
            Err(msg) => {
                if first_error.is_none() {
                    first_error = Some(msg);
                }
                break;
            }
        }
    }
    match best {
        Some((end, kind)) => TsValue::Ok { end, kind },
        None => TsValue::Err {
            end: segment_end(src, start),
            error: first_error.unwrap_or_else(|| "expected an expression".to_string()),
        },
    }
}

/// Classify one TypeScript expression (used for template-literal children too).
/// Returns oxc's first error message when it is not a valid expression.
pub fn classify_expression(text: &str) -> Result<TsValueKind, String> {
    parse_expression(text)
}

/// Find the first of `words` (e.g. `["of", "in"]`) that appears at depth 0 from
/// `from`, with identifier boundaries on both sides.
///
/// Used for the `@for` head (`tick of items`): the binding is whatever precedes
/// the keyword. Strings, template literals, comments and nested brackets are
/// skipped, so `@for (x of pick("of"))` cannot be fooled.
pub fn find_keyword(src: &str, from: usize, words: &[&str]) -> Option<(usize, usize)> {
    let bytes = src.as_bytes();
    let mut pos = from;
    let mut depth = 0usize;
    while pos < bytes.len() {
        let c = bytes[pos];
        match c {
            b'"' | b'\'' => pos = skip_quoted(src, pos),
            b'`' => pos = skip_template_literal(src, pos),
            b'/' if bytes.get(pos + 1) == Some(&b'/') => {
                while pos < bytes.len() && bytes[pos] != b'\n' {
                    pos += 1;
                }
            }
            b'/' if bytes.get(pos + 1) == Some(&b'*') => {
                pos = skip_block_comment(src, pos);
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                pos += 1;
            }
            b')' | b']' | b'}' => {
                depth = depth.saturating_sub(1);
                pos += 1;
            }
            _ => pos += 1,
        }
        // only look at identifier boundaries outside any bracket
        if depth == 0 {
            let word_start = pos - 1;
            let is_word_start = bytes
                .get(word_start)
                .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_');
            if !is_word_start {
                continue;
            }
            let mut end = pos;
            while matches!(bytes.get(end), Some(c) if c.is_ascii_alphanumeric() || *c == b'_') {
                end += 1;
            }
            let word = &src[word_start..end];
            if words.contains(&word) {
                return Some((word_start, end));
            }
            pos = end;
        }
    }
    None
}

/// Validate a standalone TypeScript expression (used for `{ expr }` children).
/// `None` when it is valid, otherwise oxc's message.
pub fn expression_error(text: &str) -> Option<String> {
    parse_expression(text).err()
}

/// Classify one TypeScript expression, or return oxc's first error message.
///
/// A value whose entries are separated only by newlines is retried with the
/// commas made explicit (`with_implicit_commas`) — that spelling is natural in
/// a config DSL and oxc's expression parser rejects it.
fn parse_expression(text: &str) -> Result<TsValueKind, String> {
    if text.trim().is_empty() {
        return Err("expected an expression".to_string());
    }
    match parse_expression_once(text) {
        Ok(kind) => Ok(kind),
        Err(first) => match with_implicit_commas(text) {
            Some(normalized) => parse_expression_once(&normalized),
            None => Err(first),
        },
    }
}

fn parse_expression_once(text: &str) -> Result<TsValueKind, String> {
    let allocator = Allocator::default();
    match Parser::new(&allocator, text, SourceType::tsx()).parse_expression() {
        Ok(expr) => Ok(classify(&expr)),
        Err(diagnostics) => Err(diagnostics
            .first()
            .map(|d| d.message.to_string())
            .unwrap_or_else(|| "invalid expression".to_string())),
    }
}

/// The AST decides what the value is.
fn classify(expr: &Expression<'_>) -> TsValueKind {
    match expr {
        Expression::StringLiteral(lit) => TsValueKind::String(lit.value.as_str().to_string()),
        Expression::NumericLiteral(lit) => TsValueKind::Number(lit.value),
        Expression::BooleanLiteral(lit) => TsValueKind::Boolean(lit.value),
        Expression::NullLiteral(_) => TsValueKind::Null,
        // A template literal with no interpolation is just a string.
        Expression::TemplateLiteral(tpl) if tpl.expressions.is_empty() => tpl
            .quasis
            .first()
            .and_then(|q| q.value.cooked.as_ref())
            .map(|cooked| TsValueKind::String(cooked.as_str().to_string()))
            .unwrap_or(TsValueKind::Other),
        Expression::Identifier(ident) => TsValueKind::Ident(ident.name.as_str().to_string()),
        _ => TsValueKind::Other,
    }
}

// ---------------------------------------------------------------------------
// The DML boundary scanner
// ---------------------------------------------------------------------------
//
// The DSL owns member boundaries (`@a: x, @b: y` is two members; `x` and `y`
// are values), so a candidate boundary needs a scan that understands brackets,
// strings, template interpolation, comments and regex literals. This is only a
// *candidate* generator: correctness comes from oxc accepting the candidate.

/// The end of the DML segment starting at `from` (trailing trivia excluded).
fn segment_end(src: &str, from: usize) -> usize {
    let bytes = src.as_bytes();
    let mut pos = from;
    let mut depth = 0usize;
    let mut prev_sig: Option<u8> = None;
    let mut pending_infix = false;
    while let Some(c) = bytes.get(pos).copied() {
        if depth == 0 && (c == b',' || c == b'}' || c == b')' || c == b']') {
            // a top-level `,`/`}` is a DML member boundary; a top-level `)`/`]`
            // closes the construct the value sits in (`@if (cond) { … }`,
            // `.key(x)`, `[… @k: v]`) and can never be part of the value
            break;
        }
        if depth == 0
            && (c.is_ascii_whitespace()
                || (c == b'/' && matches!(bytes.get(pos + 1), Some(b'/') | Some(b'*'))))
        {
            let next = significant_index(src, pos);
            match next.map(|i| bytes[i]) {
                None => break,
                Some(b',') | Some(b'}') | Some(b'@') | Some(b')') | Some(b']') => break,
                Some(n)
                    if pending_infix
                        || continues_expression(n)
                        || prev_sig.is_some_and(|p| !ends_expression(p)) =>
                {
                    pending_infix = false;
                    pos = skip_trivia(src, pos);
                    continue;
                }
                // `x as T` / `x satisfies T` / … : let oxc decide whether the
                // continuation really is part of the expression.
                _ if next_is_infix_keyword(src, pos) => {
                    pending_infix = true;
                    pos = skip_trivia(src, pos);
                    continue;
                }
                _ => break,
            }
        }
        match c {
            b'"' | b'\'' => pos = skip_quoted(src, pos),
            b'`' => pos = skip_template_literal(src, pos),
            b'/' if bytes.get(pos + 1) == Some(&b'/') => {
                while let Some(c) = bytes.get(pos) {
                    if *c == b'\n' {
                        break;
                    }
                    pos += 1;
                }
            }
            b'/' if bytes.get(pos + 1) == Some(&b'*') => {
                pos = skip_block_comment(src, pos);
            }
            b'/' => {
                let regex_ok = match prev_sig {
                    None => true,
                    Some(p) => matches!(
                        p,
                        b'(' | b','
                            | b'='
                            | b':'
                            | b'['
                            | b'{'
                            | b'!'
                            | b'&'
                            | b'|'
                            | b'?'
                            | b';'
                            | b'+'
                            | b'-'
                            | b'*'
                            | b'%'
                            | b'<'
                            | b'>'
                            | b'~'
                            | b'^'
                    ),
                };
                if regex_ok && bytes.get(pos + 1) != Some(&b'=') {
                    pos = skip_regex(src, pos);
                } else {
                    pos += 1;
                }
                prev_sig = Some(b'/');
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                pos += 1;
                prev_sig = Some(c);
            }
            b')' | b']' | b'}' => {
                depth = depth.saturating_sub(1);
                pos += 1;
                prev_sig = Some(c);
            }
            _ => {
                pos += 1;
                if !c.is_ascii_whitespace() {
                    prev_sig = Some(c);
                }
            }
        }
    }
    // leave trailing trivia out of the segment
    trim_end_index(src, from, pos)
}

/// `pos` moved back over trailing whitespace (never before `from`).
fn trim_end_index(src: &str, from: usize, mut pos: usize) -> usize {
    let bytes = src.as_bytes();
    while pos > from && bytes[pos - 1].is_ascii_whitespace() {
        pos -= 1;
    }
    pos
}

/// Index of the next byte that is neither whitespace nor a comment.
fn significant_index(src: &str, from: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut i = from;
    loop {
        match bytes.get(i).copied() {
            Some(c) if c.is_ascii_whitespace() => i += 1,
            Some(b'/') if bytes.get(i + 1) == Some(&b'/') => {
                while let Some(c) = bytes.get(i) {
                    if *c == b'\n' {
                        break;
                    }
                    i += 1;
                }
            }
            Some(b'/') if bytes.get(i + 1) == Some(&b'*') => {
                i = skip_block_comment(src, i);
            }
            Some(_) => return Some(i),
            None => return None,
        }
    }
}

/// The next significant byte at or after `from`, or `None` at the end.
fn significant_byte(src: &str, from: usize) -> Option<u8> {
    significant_index(src, from).map(|i| src.as_bytes()[i])
}

/// `pos` moved past whitespace and comments (a line break is whitespace).
fn skip_trivia(src: &str, mut pos: usize) -> usize {
    let bytes = src.as_bytes();
    loop {
        match bytes.get(pos).copied() {
            Some(c) if c.is_ascii_whitespace() => pos += 1,
            Some(b'/') if bytes.get(pos + 1) == Some(&b'/') => {
                while let Some(c) = bytes.get(pos) {
                    if *c == b'\n' {
                        break;
                    }
                    pos += 1;
                }
            }
            Some(b'/') if bytes.get(pos + 1) == Some(&b'*') => {
                pos = skip_block_comment(src, pos);
            }
            _ => return pos,
        }
    }
}

/// End of the `/* … */` comment starting at `from`.
fn skip_block_comment(text: &str, from: usize) -> usize {
    let bytes = text.as_bytes();
    let mut i = from + 2;
    while i < bytes.len() && !(bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/')) {
        i += 1;
    }
    (i + 2).min(bytes.len())
}

/// End of the string starting at `from` (which is the opening quote), honouring
/// `\` escapes.
fn skip_quoted(src: &str, from: usize) -> usize {
    let bytes = src.as_bytes();
    let quote = bytes[from];
    let mut i = from + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            c if c == quote => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// End of the template literal starting at `from` (the opening backtick).
/// `${ … }` interpolation is skipped with bracket matching, so a `}` or a
/// backtick inside an interpolation cannot end the literal early.
pub fn skip_template_literal(src: &str, from: usize) -> usize {
    let bytes = src.as_bytes();
    let mut i = from + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'`' => return i + 1,
            b'$' if bytes.get(i + 1) == Some(&b'{') => {
                i += 2;
                let mut depth = 1usize;
                while i < bytes.len() && depth > 0 {
                    match bytes[i] {
                        b'{' => depth += 1,
                        b'}' => depth -= 1,
                        _ => {}
                    }
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    bytes.len()
}

/// End of the regex literal starting at `from` (the opening `/`). A `\` escapes
/// the next byte, `[…]` is a class where `/` is literal, and the literal ends at
/// the first unescaped `/` outside a class, followed by its flags.
fn skip_regex(src: &str, from: usize) -> usize {
    let bytes = src.as_bytes();
    let mut i = from + 1;
    let mut in_class = false;
    while let Some(c) = bytes.get(i).copied() {
        match c {
            b'\\' => i += 2,
            b'[' => {
                in_class = true;
                i += 1;
            }
            b']' => {
                in_class = false;
                i += 1;
            }
            b'/' if !in_class => {
                i += 1;
                while matches!(bytes.get(i), Some(c) if c.is_ascii_alphabetic()) {
                    i += 1;
                }
                return i;
            }
            b'\n' => return i,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// Can this byte continue an expression that just ended a line?
///
/// `{` is deliberately absent: a `{` after a value opens a **DML block**
/// (`@if (cond) { … }`, `div { … }`), never an object literal — a literal brace
/// is consumed by the scan itself (as the value's first byte, or right after
/// `?`/`=>`/`:` where `prev_sig` already forces continuation).
fn continues_expression(c: u8) -> bool {
    matches!(
        c,
        b'.' | b'?'
            | b':'
            | b'+'
            | b'-'
            | b'*'
            | b'/'
            | b'%'
            | b'&'
            | b'|'
            | b'^'
            | b'='
            | b'<'
            | b'>'
            | b'!'
            | b'~'
            | b'('
            | b'['
            | b'`'
    )
}

/// Can this byte end an expression? Operators cannot, so after them the value
/// must continue (`"a" +` / `"b"`).
fn ends_expression(c: u8) -> bool {
    !matches!(
        c,
        b'+' | b'-'
            | b'*'
            | b'/'
            | b'%'
            | b'&'
            | b'|'
            | b'^'
            | b'!'
            | b'~'
            | b'='
            | b'<'
            | b'>'
            | b'?'
            | b':'
            | b','
            | b'('
            | b'['
            | b'{'
            | b'.'
    )
}

/// Is the next significant token an infix keyword (`as` / `satisfies` /
/// `instanceof` / `in`)? The maximal munch still has the last word — this only
/// decides whether the candidate is worth offering to oxc.
fn next_is_infix_keyword(src: &str, pos: usize) -> bool {
    find_keyword(
        src,
        significant_index(src, pos).unwrap_or(pos),
        &["as", "satisfies", "instanceof", "in"],
    )
    .is_some()
}

/// Insert the commas a DML author left implicit between object/array entries
/// separated only by a newline.
///
/// DML is a configuration DSL: `aliases: { a: "x"\n b: "y" }` reads as two
/// entries, exactly like the newline-separated members of an element. oxc's
/// expression parser is stricter than the statement parser here and rejects it,
/// so the value is retried with the commas made explicit.
///
/// Only *structural* newlines are touched: inside a string, template literal,
/// regex or comment nothing changes, and a newline that already follows a `,`
/// `{` `[` gets no extra comma.
fn with_implicit_commas(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len() + 8);
    let mut depth: i32 = 0;
    // last significant byte written, to know whether a comma is needed
    let mut prev_sig: Option<u8> = None;
    let mut i = 0usize;
    let mut changed = false;
    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b'"' | b'\'' => {
                let end = skip_quoted(text, i);
                out.push_str(&text[i..end]);
                prev_sig = Some(bytes[end - 1]);
                i = end;
                continue;
            }
            b'`' => {
                let end = skip_template_literal(text, i);
                out.push_str(&text[i..end]);
                prev_sig = Some(b'`');
                i = end;
                continue;
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    out.push(bytes[i] as char);
                    i += 1;
                }
                continue;
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                let end = skip_block_comment(text, i);
                out.push_str(&text[i..end]);
                i = end;
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'\n' if depth > 0 => {
                // A newline inside a literal. If the next significant byte
                // starts a new entry and the previous one did not already end
                // with a separator, a comma was meant.
                let next = significant_index(text, i);
                match next.map(|j| bytes[j]) {
                    Some(n)
                        if !matches!(n, b',' | b'}' | b']' | b')')
                            && !matches!(prev_sig, Some(b',') | Some(b'{') | Some(b'[') | None) =>
                    {
                        out.push(',');
                        changed = true;
                    }
                    _ => {}
                }
                out.push('\n');
                i += 1;
                continue;
            }
            _ => {}
        }
        if !c.is_ascii_whitespace() {
            prev_sig = Some(c);
        }
        out.push(c as char);
        i += 1;
    }
    changed.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::{
        expression_error, find_keyword, parse_expression, parse_value, with_implicit_commas, TsValue,
        TsValueKind,
    };

    /// The kind of the value in `src` (which ends where the DML block would).
    fn value(src: &str) -> (usize, TsValueKind) {
        match parse_value(src, 0) {
            TsValue::Ok { end, kind } => (end, kind),
            TsValue::Err { error, .. } => panic!("{src:?} should parse: {error}"),
        }
    }

    /// The source text of the parsed value.
    fn text(src: &str) -> String {
        let (end, _) = value(src);
        src[..end].to_string()
    }

    #[test]
    fn classifies_literals_by_the_ast() {
        assert_eq!(value("170 }").1, TsValueKind::Number(170.0));
        assert_eq!(value("true }").1, TsValueKind::Boolean(true));
        assert_eq!(value("null }").1, TsValueKind::Null);
        assert_eq!(value("\"x\" }").1, TsValueKind::String("x".into()));
        assert_eq!(value("`plain` }").1, TsValueKind::String("plain".into()));
        assert_eq!(value("heroImg }").1, TsValueKind::Ident("heroImg".into()));
        assert_eq!(value("`hi ${n}` }").1, TsValueKind::Other);
        assert_eq!(value("cls() }").1, TsValueKind::Other);
    }

    #[test]
    fn values_stop_at_the_dml_boundary() {
        // a top-level comma or `}` ends the value; the rest is another member
        assert_eq!(text("a, b }"), "a");
        assert_eq!(text("a }"), "a");
        assert_eq!(text("\"x\" }"), "\"x\"");
    }

    /// Malformed input is reported, with a tolerant boundary to fall back on.
    #[test]
    fn malformed_values_are_reported() {
        for src in ["a + }", "cls( }", ") }", "{ color: } }"] {
            match parse_value(src, 0) {
                TsValue::Ok { .. } => panic!("{src:?} should not parse"),
                TsValue::Err { error, .. } => assert!(!error.is_empty()),
            }
        }
        // a malformed tail after a valid value leaves the valid prefix in place
        // (`1 2` → value `1`, then the parser reports the stray `2` as a member)
        assert!(matches!(parse_value("1 2 }", 0), TsValue::Ok { end: 1, .. }));
        assert!(parse_value("   }", 0).eq(&TsValue::Err {
            end: 0,
            error: "expected an expression".to_string()
        }));
    }

    /// `{ expr }` children are validated by the same TS parse.
    #[test]
    fn expression_validation() {
        assert!(expression_error("count.read()").is_none());
        assert!(expression_error("a +").is_some());
    }

    /// A multi-line object/array value is ONE value: newline-separated entries
    /// are valid TypeScript, so the boundary scan must not cut at the first
    /// line break. Regression: `aliases: { a: "x"\n b: "y" }` reported
    /// "Expected `,` or `}` but found `Identifier`".
    #[test]
    fn multiline_object_and_array_values_are_one_value() {
        for src in [
            "{ k: \"v\"\n j: \"w\" }",
            "{\n  k: \"v\"\n  j: \"w\"\n}",
            "[ \"v\"\n  \"w\" ]",
            "{\n  a: [\n    1\n    2\n  ]\n}",
        ] {
            match parse_value(src, 0) {
                TsValue::Ok { .. } => {}
                TsValue::Err { error, .. } => panic!("{src:?} should parse: {error}"),
            }
        }
    }

    /// The comma insertion must not rewrite what is inside a string, a template
    /// literal or a comment — only structural newlines.
    #[test]
    fn implicit_commas_leave_literal_contents_alone() {
        // a newline inside a string is content, never a separator
        assert_eq!(with_implicit_commas("[\"a\nb\"]"), None);
        // an already-separated entry gets no second comma
        assert_eq!(with_implicit_commas("{ a: 1,\n b: 2 }"), None);
        // a trailing comma before the brace needs nothing
        assert_eq!(with_implicit_commas("{ a: 1,\n}"), None);
        // the structural case does change
        assert_eq!(
            with_implicit_commas("{ a: 1\n b: 2 }").as_deref(),
            Some("{ a: 1,\n b: 2 }")
        );
        // and the result parses
        assert!(parse_expression(&with_implicit_commas("{ a: 1\n b: 2 }").unwrap()).is_ok());
    }

    /// `find_keyword` must not be fooled by brackets or strings.
    #[test]
    fn keyword_search_skips_nested_constructs() {
        assert_eq!(find_keyword("tick of items", 0, &["of", "in"]), Some((5, 7)));
        // the `of` inside the call argument is skipped; the loop keyword after
        // it is what gets returned
        assert_eq!(find_keyword("pick(\"of\") of xs", 0, &["of"]), Some((11, 13)));
        assert_eq!(find_keyword("a + b", 0, &["of", "in"]), None);
    }
}
