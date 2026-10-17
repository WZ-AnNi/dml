//! napi-binding — the Node `.node` entry point for the TSDML compiler.
//!
//! Responsibility: bridge the pure-Rust crates (dml-parser / dml-ast /
//! dml-codegen) across the N-API boundary. It only exposes thin functions; all
//! real logic lives in the compiler crates. Compiled to
//! `tsdml_compiler.<platform>.node`.
//!
//! `parse` and `compile` are tolerant: they never throw on malformed DML —
//! they return a best-effort result (parse errors are reported via the
//! `errors` key in `compile_with_spans`; `parse` keeps its JSON shape and
//! includes errors).
//!
//! NOTE: This uses `napi-rs` v3. The `#[napi]` attributes are parsed by the
//! `napi-derive` proc-macro when built through `@napi-rs/cli` (`napi build`).

use dml_codegen::{generate_document, generate_document_with_spans, generate_module};
use dml_parser::parse_document;

/// Parse a DML source string and return the DML-AST as a JSON string.
///
/// The AST is serialized to JSON so JS consumers can `JSON.parse` it without
/// requiring a hand-written binding per node type.
#[napi_derive::napi]
pub fn parse(source: String) -> String {
    let out = parse_document(&source);
    let mut value = json_from_doc(&out.document);
    if let serde_json::Value::Object(ref mut obj) = value {
        let errs: Vec<serde_json::Value> = out
            .errors
            .iter()
            .map(|e| serde_json::json!({ "message": e.message, "span": e.span }) )
            .collect();
        obj.insert("errors".to_string(), serde_json::Value::Array(errs));
    }
    serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string())
}

/// Compile a DML source string into framework runtime-call source code
/// (the TSDML lowering).
#[napi_derive::napi]
pub fn compile(source: String) -> String {
    let out = parse_document(&source);
    generate_document(&out.document)
}

/// Compile a DML source string and return `{ code, spans }` where `spans` is
/// the authoritative raw↔lowered map (role, raw byte span in `source`,
/// lowered byte span in `code`), plus any parse errors under `errors`.
/// The editor (Volar via @tsdml/transform) uses this to map template tokens
/// to lowered positions without any heuristic re-scanning.
#[napi_derive::napi]
pub fn compile_with_spans(source: String) -> String {
    let out = parse_document(&source);
    let (code, spans) = generate_document_with_spans(&out.document);
    let errs: Vec<serde_json::Value> = out
        .errors
        .iter()
        .map(|e| serde_json::json!({ "message": e.message, "span": e.span }) )
        .collect();
    serde_json::to_string(&serde_json::json!({
        "code": code,
        "spans": spans,
        "errors": errs,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

/// Lower one template block into the **optimizing build output**:
/// a hoisted static template shape plus index-addressed bindings, i.e. the
/// Solid/Vapor-style runtime IR (no element factory calls, no props objects
/// per render, static/dynamic split at compile time).
///
/// Returns `{ shape, prelude, expr, helpers }`. `suffix` disambiguates the
/// hoisted template constants across the blocks of one module.
#[napi_derive::napi]
pub fn compile_module(source: String, suffix: u32) -> String {
    let out = parse_document(&source);
    let m = generate_module(&out.document, suffix as usize);
    serde_json::to_string(&serde_json::json!({
        "shape": m.shape,
        "prelude": m.prelude,
        "expr": m.expr,
        "helpers": m.helpers,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

/// Minimal conversion from the AST into a serde-serializable value tree.
fn json_from_doc(doc: &dml_ast::Document) -> serde_json::Value {
    element_to_json(&doc.root)
}

fn member_to_json(m: &dml_ast::Member) -> serde_json::Value {
    use dml_ast::Member;
    match m {
        Member::Attribute { name, value, name_span, value_span } => serde_json::json!({
            "kind": "attribute",
            "name": name,
            "value": value_to_json(value),
            "nameSpan": span_to_json(*name_span),
            "valueSpan": span_to_json(*value_span),
        }),
        Member::Element(el) => element_to_json(el),
        Member::Text { text, span } => serde_json::json!({
            "kind": "text", "value": text, "span": span_to_json(*span)
        }),
        Member::Expr { expr, span } => serde_json::json!({
            "kind": "expr", "value": expr, "span": span_to_json(*span)
        }),
        Member::Sequence(items) => {
            let arr: Vec<serde_json::Value> = items.iter().map(member_to_json).collect();
            serde_json::json!({ "kind": "sequence", "items": arr })
        }
        Member::NamespaceScope { prefix, inner } => {
            let arr: Vec<serde_json::Value> = inner.iter().map(member_to_json).collect();
            serde_json::json!({ "kind": "namespaceScope", "prefix": prefix, "inner": arr })
        }
        // A control-flow block is transparent to the editor's structural model:
        // what matters there is the elements/attributes it wraps, so the body is
        // serialized as a sequence (`@if`/`@for` add no DOM node of their own).
        Member::Directive(d) => {
            let items: Vec<serde_json::Value> = d.body.iter().map(member_to_json).collect();
            serde_json::json!({ "kind": "sequence", "items": items })
        }
        // A macro component call is also transparent to the editor's structural model:
        // the body members are what matter, so serialize as a sequence.
        Member::MacroCall(m) => {
            let items: Vec<serde_json::Value> = m.body.iter().map(member_to_json).collect();
            serde_json::json!({
                "kind": "macroCall",
                "name": m.name,
                "nameSpan": span_to_json(m.name_span),
                "headSrc": m.head_src,
                "headSpan": span_to_json(m.head_span),
                "span": span_to_json(m.span),
                "items": items
            })
        }
    }
}

fn element_to_json(el: &dml_ast::Element) -> serde_json::Value {
    let members: Vec<serde_json::Value> = el.members.iter().map(member_to_json).collect();
    serde_json::json!({
        "kind": "element",
        "name": el.name,
        "span": span_to_json(el.span),
        "members": members
    })
}

/// Span → `{start,end}` (line/col omitted — raw-offset routing only needs bytes).
fn span_to_json(s: Option<dml_ast::Span>) -> serde_json::Value {
    match s {
        Some(sp) => serde_json::json!({ "start": sp.start, "end": sp.end }),
        None => serde_json::Value::Null,
    }
}

fn value_to_json(v: &dml_ast::DmlValue) -> serde_json::Value {
    use dml_ast::DmlValue;
    match v {
        DmlValue::String(s) => serde_json::json!({ "type": "string", "value": s }),
        DmlValue::Number(n) => serde_json::json!({ "type": "number", "value": n }),
        DmlValue::Boolean(b) => serde_json::json!({ "type": "boolean", "value": b }),
        DmlValue::Null => serde_json::json!({ "type": "null" }),
        DmlValue::Bare(b) => serde_json::json!({ "type": "bare", "value": b }),
        DmlValue::Expr(e) => serde_json::json!({ "type": "expr", "value": e }),
        DmlValue::Array(items) => {
            let arr: Vec<serde_json::Value> = items.iter().map(value_to_json).collect();
            serde_json::json!({ "type": "array", "items": arr })
        }
        DmlValue::Object(pairs) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in pairs {
                obj.insert(k.clone(), value_to_json(v));
            }
            serde_json::json!({ "type": "object", "value": obj })
        }
    }
}
