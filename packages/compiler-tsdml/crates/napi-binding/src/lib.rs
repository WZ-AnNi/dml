//! napi-binding — the Node `.node` entry point for the TSDML compiler.
//!
//! Responsibility: bridge the pure-Rust crates (dml-parser / dml-ast) across
//! the N-API boundary. It only exposes thin functions; all real logic lives in
//! the compiler crates. Compiled to `tsdml_compiler.<platform>.node`.
//!
//! NOTE: This uses `napi-rs` v3. The `#[napi]` attributes are parsed by the
//! `napi-derive` proc-macro when built through `@napi-rs/cli` (`napi build`).

use dml_codegen::generate_document;
use dml_parser::parse_document;

/// Parse a DML source string and return the DML-AST as a JSON string.
///
/// The AST is serialized to JSON so JS consumers can `JSON.parse` it without
/// requiring a hand-written binding per node type. Throws a JS Error on parse
/// failure.
///
/// ```js
/// const { parse } = require('@tsdml/compiler') // or the .node binding
/// const astJson = parse('div { @class: "x" }')
/// ```
#[napi_derive::napi]
pub fn parse(source: String) -> napi::Result<String> {
    parse_document(&source)
        .map(|doc| {
            serde_json::to_string(&json_from_doc(&doc))
                .unwrap_or_else(|_| "{}".to_string())
        })
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Compile a DML source string into framework runtime-call source code
/// (the TSDML lowering). Equivalent to `parse` followed by `generate_document`.
///
/// ```js
/// const { compile } = require('@tsdml/compiler')
/// const js = compile('div { @class: "x", p { "hi" } }')
/// // => e("div", { "class": "x" }, e("p", null, "hi"))
/// ```
#[napi_derive::napi]
pub fn compile(source: String) -> napi::Result<String> {
    parse_document(&source)
        .map(|doc| generate_document(&doc))
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Minimal conversion from the AST into a serde-serializable value tree.
fn json_from_doc(doc: &dml_ast::Document) -> serde_json::Value {
    element_to_json(&doc.root)
}

fn member_to_json(m: &dml_ast::Member) -> serde_json::Value {
    use dml_ast::Member;
    match m {
        Member::Attribute { name, value } => serde_json::json!({
            "kind": "attribute",
            "name": name,
            "value": value_to_json(value),
        }),
        Member::Element(el) => element_to_json(el),
        Member::Text(text) => serde_json::json!({ "kind": "text", "value": text }),
        Member::Expr(expr) => serde_json::json!({ "kind": "expr", "value": expr }),
        Member::Sequence(items) => {
            let arr: Vec<serde_json::Value> = items.iter().map(member_to_json).collect();
            serde_json::json!({ "kind": "sequence", "items": arr })
        }
        Member::NamespaceScope { prefix, inner } => {
            let arr: Vec<serde_json::Value> = inner.iter().map(member_to_json).collect();
            serde_json::json!({ "kind": "namespaceScope", "prefix": prefix, "inner": arr })
        }
    }
}

fn element_to_json(el: &dml_ast::Element) -> serde_json::Value {
    let members: Vec<serde_json::Value> = el.members.iter().map(member_to_json).collect();
    serde_json::json!({ "kind": "element", "name": el.name, "members": members })
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
            let obj = serde_json::Map::new();
            let mut obj = obj;
            for (k, v) in pairs {
                obj.insert(k.clone(), value_to_json(v));
            }
            serde_json::json!({ "type": "object", "value": obj })
        }
    }
}
