//! dml-codegen — turn a DML-AST into framework runtime calls.
//!
//! Responsibility: consume `dml_ast::Document` and emit the "runtime invocation"
//! source the DML-Framework executes — currently the `e(tag, props, children)`
//! call shape defined in DML-Framework.md §4.2 / §3.
//!
//! This is the TSDML lowering core: DML (declarative) becomes JS/TS calls that
//! the runtime understands. It is intentionally pure text generation so the
//! output can be tested independently of any host or bundler.
//!
//! Output shape (hand-written equivalent, see DML-Framework.md §3):
//!   e("div", { class: "x" }, [ e("p", {}, "hello") ])
//!
//! Namespace scopes are flattened here: `@android: { layout_width: "x" }`
//! becomes prop `android:layout_width: "x"`.

use dml_ast::{DmlValue, Document, Element, Member};

/// Runtime call helper used in the output.
pub const RUNTIME_FN: &str = "e";

/// Emit a complete runtime call expression for a DML document.
pub fn generate_document(doc: &Document) -> String {
    generate_element(&doc.root)
}

/// Emit a runtime call for a single element.
pub fn generate_element(el: &Element) -> String {
    let mut props: Vec<String> = Vec::new();
    let mut children: Vec<String> = Vec::new();

    for member in &el.members {
        match member {
            Member::Attribute { name, value } => {
                props.push(format!("{name:?}: {}", generate_value(value)));
            }
            Member::NamespaceScope { prefix, inner } => {
                // flatten: every bare attribute inside becomes `<prefix>:<key>`
                for m in inner {
                    if let Member::Attribute { name, value } = m {
                        props.push(format!(
                            "{:?}: {}",
                            format!("{prefix}:{name}"),
                            generate_value(value)
                        ));
                    }
                    // elements / text inside a namespace scope are treated as children
                    match m {
                        Member::Element(inner_el) => children.push(generate_element(inner_el)),
                        Member::Text(t) => children.push(format!("{t:?}")),
                        _ => {}
                    }
                }
            }
            Member::Text(t) => children.push(format!("{t:?}")),
            Member::Expr(e) => children.push(e.clone()),
            Member::Sequence(items) => {
                for item in items {
                    match item {
                        Member::Element(child) => children.push(generate_element(child)),
                        Member::Text(t) => children.push(format!("{t:?}")),
                        Member::Expr(e) => children.push(e.clone()),
                        _ => children.push(generate_member_expr(item)),
                    }
                }
            }
            Member::Element(child) => children.push(generate_element(child)),
        }
    }

    let props_str = if props.is_empty() && children.is_empty() {
        String::new()
    } else if props.is_empty() {
        format!("null, {}", format_children(&children))
    } else if children.is_empty() {
        format!("{{ {} }}", props.join(", "))
    } else {
        format!(
            "{{ {} }}, {}",
            props.join(", "),
            format_children(&children)
        )
    };

    if props_str.is_empty() {
        format!(
            "{RUNTIME_FN}({:?})",
            el.name
        )
    } else {
        format!(
            "{RUNTIME_FN}({:?}, {props_str})",
            el.name
        )
    }
}

fn format_children(children: &[String]) -> String {
    if children.is_empty() {
        "null".to_string()
    } else if children.len() == 1 {
        children[0].clone()
    } else {
        format!("[ {} ]", children.join(", "))
    }
}

/// Fallback for unusual members appearing directly in a sequence.
fn generate_member_expr(m: &Member) -> String {
    match m {
        Member::Element(el) => generate_element(el),
        Member::Text(t) => format!("{t:?}"),
        Member::NamespaceScope { prefix, inner } => {
            // represent as a plain object prop bag (rare in sequences)
            let parts: Vec<String> = inner
                .iter()
                .filter_map(|im| match im {
                    Member::Attribute { name, value } => Some(format!(
                        "{:?}: {}",
                        format!("{prefix}:{name}"),
                        generate_value(value)
                    )),
                    _ => None,
                })
                .collect();
            format!("{{ {} }}", parts.join(", "))
        }
        _ => "null".to_string(),
    }
}

/// Emit a JS/TS literal for a DML value.
pub fn generate_value(v: &DmlValue) -> String {
    match v {
        DmlValue::String(s) => format!("{s:?}"),
        DmlValue::Number(n) => {
            // keep integers integral
            if n.fract() == 0.0 && n.is_finite() {
                format!("{n}")
            } else {
                format!("{n}")
            }
        }
        DmlValue::Boolean(b) => format!("{b}"),
        DmlValue::Null => "null".to_string(),
        DmlValue::Bare(b) => b.clone(),
        DmlValue::Expr(e) => e.clone(),
        DmlValue::Array(items) => {
            let inner: Vec<String> = items.iter().map(generate_value).collect();
            format!("[ {} ]", inner.join(", "))
        }
        DmlValue::Object(pairs) => {
            let inner: Vec<String> = pairs
                .iter()
                .map(|(k, v)| format!("{k:?}: {}", generate_value(v)))
                .collect();
            format!("{{ {} }}", inner.join(", "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dml_ast::{DmlValue, Member};

    fn el(name: &str, members: Vec<Member>) -> Element {
        Element { name: name.to_string(), members, span: None }
    }
    fn attr(name: &str, value: DmlValue) -> Member {
        Member::Attribute { name: name.to_string(), value }
    }

    #[test]
    fn generates_empty_element() {
        let doc = Document { root: el("div", vec![]) };
        assert_eq!(generate_document(&doc), r#"e("div")"#);
    }

    #[test]
    fn generates_attrs_and_text() {
        let doc = Document {
            root: el(
                "button",
                vec![
                    attr("class", DmlValue::String("btn".into())),
                    Member::Text("click".into()),
                ],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"e("button", { "class": "btn" }, "click")"#
        );
    }

    #[test]
    fn generates_children() {
        let doc = Document {
            root: el(
                "div",
                vec![Member::Element(el(
                    "p",
                    vec![Member::Text("hi".into())],
                ))],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"e("div", null, e("p", null, "hi"))"#
        );
    }

    #[test]
    fn flattens_namespace_scope() {
        let doc = Document {
            root: el(
                "LinearLayout",
                vec![Member::NamespaceScope {
                    prefix: "android".into(),
                    inner: vec![attr(
                        "layout_width",
                        DmlValue::String("match_parent".into()),
                    )],
                }],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"e("LinearLayout", { "android:layout_width": "match_parent" })"#
        );
    }

    #[test]
    fn generates_multiple_children_sequence() {
        let doc = Document {
            root: el(
                "svg",
                vec![Member::Sequence(vec![
                    Member::Element(el("rect", vec![])),
                    Member::Element(el("circle", vec![])),
                ])],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"e("svg", null, [ e("rect"), e("circle") ])"#
        );
    }

    #[test]
    fn emits_tsdml_expressions_verbatim() {
        // backtick expressions in props and children are emitted as-is
        let doc = Document {
            root: el(
                "span",
                vec![
                    attr("class", DmlValue::Expr("cls()".into())),
                    Member::Expr("count()".into()),
                ],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"e("span", { "class": cls() }, count())"#
        );
    }
}