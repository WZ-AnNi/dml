//! dml-codegen::module — the *optimizing build backend*.
//!
//! `generate_document` (see `lib.rs`) emits the **typed IR**: `e(tag, props,
//! children)` calls that the TypeScript compiler can type-check. That IR is
//! what the editor's language service sees; it is deliberately simple and is
//! never shipped.
//!
//! This module emits the **runtime IR**: the shape a compiler like Solid or
//! Vue Vapor produces.
//!
//!   1. The static part of a template is hoisted to a module-scope constant
//!      `const _$t0 = _$template([...shape...])`. The host builds that shape
//!      once and clones it for every instance — no element factory calls, no
//!      props objects and no children arrays per render.
//!   2. Every node gets an **index** in the flat, pre-order walk of the
//!      template. Bindings address nodes by that integer:
//!      `_$setProp(_n$[3], "src", heroImg)`.
//!   3. Static/dynamic is split at compile time. Literal props live in the
//!      shape; plain identifiers are applied once; only expressions that can
//!      change (`foo()`, `props.x`, `a.b`) become reactive bindings wrapped in
//!      a render-effect. Events are never reactive.
//!   4. Component tags (Capitalized) lower to a direct call
//!      `Counter({ ...props })` — no element factory, no `e` argument. Dynamic
//!      props become getters so the component keeps tracking them.
//!
//! The result is the module-scope `prelude` (template constants) plus an
//! `expr` that replaces the `@{ ... }` block in place.

use dml_ast::{
    Directive, DirectiveKind, Document, DmlValue, Element, ElseArm, MacroCall, Member, Span,
};
use std::collections::BTreeSet;

// Runtime helper names, as imported from the host runtime module.
pub const H_TEMPLATE: &str = "template";
pub const H_INSERT: &str = "insert";
pub const H_SET_PROP: &str = "setProp";
pub const H_SET_PROP_REACTIVE: &str = "setPropReactive";
pub const H_ON: &str = "on";
/// Keyed list primitive (only `@for` + `@key` needs runtime state).
pub const H_EACH: &str = "each";

/// The compiler-generated local that holds the instantiated node list.
const NODES: &str = "_n$";

/// Result of lowering one `@{ ... }` block for the build.
pub struct ModuleOutput {
    /// The base template's static shape (JS array literal).
    pub shape: String,
    /// Module-scope declarations to hoist: template constants.
    pub prelude: String,
    /// Expression that replaces the `@{ ... }` block.
    pub expr: String,
    /// Runtime helpers the emitted code calls (sorted, deduped).
    pub helpers: Vec<String>,
}

/// Lower one template block: static shape + index-addressed dynamic bindings.
///
/// `suffix` disambiguates the hoisted template constants when a module
/// contains several template blocks (pass the block's index).
pub fn generate_module(doc: &Document, suffix: usize) -> ModuleOutput {
    let mut em = Emitter::new(suffix);
    let expr = em.template_expr(&doc.root);
    let shape = em.root_shape.clone();
    ModuleOutput {
        shape,
        prelude: em.preludes.join("\n"),
        expr,
        helpers: em.helpers.iter().map(|h| h.to_string()).collect(),
    }
}

struct Emitter {
    /// Index of the next node in the flat pre-order walk of the template
    /// currently being emitted. Reset per template.
    next_index: usize,
    /// Module-scope template constant declarations.
    preludes: Vec<String>,
    /// Counter for nested template constant names.
    template_counter: usize,
    /// Suffix of the block being compiled (from the caller).
    block_suffix: usize,
    /// Statements applied after the current template is instantiated.
    bindings: Vec<String>,
    /// Runtime helpers used so far.
    helpers: BTreeSet<&'static str>,
    /// Shape of the outermost template (reported to the caller).
    root_shape: String,
}

impl Emitter {
    fn new(block_suffix: usize) -> Self {
        Self {
            next_index: 0,
            preludes: Vec::new(),
            template_counter: 0,
            block_suffix,
            bindings: Vec::new(),
            helpers: BTreeSet::new(),
            root_shape: String::new(),
        }
    }

    fn take_index(&mut self) -> usize {
        let i = self.next_index;
        self.next_index += 1;
        i
    }

    fn next_template_name(&mut self) -> String {
        self.helpers.insert(H_TEMPLATE);
        let n = self.template_counter;
        self.template_counter += 1;
        if n == 0 {
            format!("_$t{}", self.block_suffix)
        } else {
            format!("_$t{}_{}", self.block_suffix, n)
        }
    }

    /// Compile one element tree into a complete expression: a hoisted template
    /// constant plus an IIFE that instantiates it and applies the bindings.
    ///
    /// The IIFE is what makes this usable in *expression* position — a
    /// `@{ ... }` block can appear anywhere an expression can (return value,
    /// argument, property value), and the transform only knows about the block
    /// text, not the surrounding statement.
    fn template_expr(&mut self, el: &Element) -> String {
        // A component as the root of the block is just a call — no template,
        // no placeholder node.
        if is_component(&el.name) {
            return self.component_value(el);
        }
        let name = self.next_template_name();
        let saved_bindings = std::mem::take(&mut self.bindings);
        let saved_index = self.next_index;
        self.next_index = 0;
        let shape = self.element(el, false);
        if self.root_shape.is_empty() {
            self.root_shape = shape.clone();
        }
        let bindings = std::mem::take(&mut self.bindings);
        self.bindings = saved_bindings;
        self.next_index = saved_index;
        self.preludes
            .push(format!("const {name} = _$template({shape});"));
        if bindings.is_empty() {
            return format!("{name}()[0]");
        }
        format!(
            "(() => {{ const {NODES} = {name}(); {}; return {NODES}[0] }})()",
            bindings.join("; ")
        )
    }

    /// Emit one element's shape and record its bindings. Returns JS literal.
    fn element(&mut self, el: &Element, in_svg: bool) -> String {
        let idx = self.take_index();

        if is_component(&el.name) {
            return self.component(el, idx);
        }

        let is_svg = in_svg || el.name == "svg";
        let mut static_props: Vec<(String, String)> = Vec::new();
        self.attrs(el, idx, is_svg, &mut static_props);

        let mut children: Vec<String> = Vec::new();
        for m in &el.members {
            self.child(m, is_svg, &mut children);
        }

        let props = if static_props.is_empty() {
            "null".to_string()
        } else {
            let pairs: Vec<String> = static_props
                .iter()
                .map(|(k, v)| format!("{}:{}", js_string(k), v))
                .collect();
            format!("{{{}}}", pairs.join(","))
        };
        let kids = if children.is_empty() {
            "null".to_string()
        } else {
            format!("[{}]", children.join(","))
        };
        format!("[{},{},{}]", js_string(&el.name), props, kids)
    }

    /// Collect attributes (including namespaced scopes) into either the static
    /// shape props or a binding.
    fn attrs(
        &mut self,
        el: &Element,
        idx: usize,
        is_svg: bool,
        static_props: &mut Vec<(String, String)>,
    ) {
        for m in &el.members {
            match m {
                Member::Attribute { name, value, .. } => {
                    if DIRECTIVES.contains(&name.as_str()) {
                        continue;
                    }
                    self.attr(idx, name, value, is_svg, static_props)
                }
                Member::NamespaceScope { prefix, inner } => {
                    for inner_m in inner {
                        if let Member::Attribute { name, value, .. } = inner_m {
                            self.attr(
                                idx,
                                &format!("{prefix}:{name}"),
                                value,
                                is_svg,
                                static_props,
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        let _ = el;
    }

    fn attr(
        &mut self,
        idx: usize,
        name: &str,
        value: &DmlValue,
        is_svg: bool,
        static_props: &mut Vec<(String, String)>,
    ) {
        let key = js_string(name);
        if is_event(name, value) {
            self.helpers.insert(H_ON);
            self.bindings.push(format!(
                "_$on({NODES}[{idx}],{key},{})",
                value_text(value)
            ));
            return;
        }
        if let Some(literal) = literal_text(value) {
            static_props.push((name.to_string(), literal));
            return;
        }
        let text = value_text(value);
        let svg_arg = if is_svg { ",true" } else { "" };
        if is_dynamic(&text) {
            self.helpers.insert(H_SET_PROP_REACTIVE);
            self.bindings.push(format!(
                "_$setPropReactive({NODES}[{idx}],{key},() => {text}{svg_arg})"
            ));
        } else {
            self.helpers.insert(H_SET_PROP);
            self.bindings
                .push(format!("_$setProp({NODES}[{idx}],{key},{text}{svg_arg})"));
        }
    }

    /// A directive block as a **value**: an accessor the runtime's `insert`
    /// evaluates (`@if` → `() => cond ? body : null`, `@for` → `() => […map…]`,
    /// keyed `@for` → `_$each(…)`'s accessor).
    ///
    /// Because it is a plain value, the same output works as an element child,
    /// inside a component's `children`, inside another directive's body, or as
    /// the block root.
    fn directive_value(&mut self, d: &Directive) -> String {
        match &d.kind {
            DirectiveKind::If { cond, otherwise, .. } => {
                let mut out = format!("({}) ? {}", value_text(cond), self.body_value(&d.body));
                let mut arm = otherwise.as_ref();
                while let Some(next) = arm {
                    match next {
                        ElseArm::If(chain) => {
                            let DirectiveKind::If { cond, otherwise, .. } = &chain.kind else {
                                break;
                            };
                            out.push_str(&format!(
                                " : ({}) ? {}",
                                value_text(cond),
                                self.body_value(&chain.body)
                            ));
                            arm = otherwise.as_ref();
                        }
                        ElseArm::Block { body, .. } => {
                            out.push_str(&format!(" : {}", self.body_value(body)));
                            arm = None;
                        }
                    }
                }
                format!("() => {out} : null")
            }
            DirectiveKind::For {
                var, iter, ..
            } => {
                // Extract @key from body if present
                let key_attr = d.body.iter().find_map(|m| {
                    if let Member::Attribute { name, value, .. } = m {
                        if name == "key" {
                            return Some(value.clone());
                        }
                    }
                    None
                });

                let iter = value_text(iter);
                let body = self.body_value(&d.body);
                match key_attr {
                    Some(k) => {
                        self.helpers.insert(H_EACH);
                        format!(
                            "_$each(() => {iter},({var}) => {body},({var}) => {})",
                            value_text(&k)
                        )
                    }
                    None => format!("() => Array.from({iter}).map(({var}) => {body})"),
                }
            }
        }
    }

    /// A block body as one value: an array of the members' values (nodes,
    /// strings, accessors) — `insert` handles arrays and nested accessors.
    fn body_value(&mut self, body: &[Member]) -> String {
        let mut values: Vec<String> = Vec::new();
        for m in body {
            match m {
                Member::Element(el) => values.push(self.template_expr(el)),
                Member::Text { text, .. } => values.push(js_string(text)),
                Member::Expr { expr, .. } => values.push(format!("() => {expr}")),
                Member::Directive(inner) => values.push(self.directive_value(inner)),
                Member::Sequence(items) => {
                    for it in items {
                        if let Member::Element(el) = it {
                            values.push(self.template_expr(el));
                        } else if let Member::Directive(inner) = it {
                            values.push(self.directive_value(inner));
                        }
                    }
                }
                Member::MacroCall(m) => {
                    // Emit marker call for TypeScript transform to intercept
                    let mut children = Vec::new();
                    for child in &m.body {
                        match child {
                            Member::Element(el) => children.push(self.template_expr(el)),
                            Member::Directive(d) => children.push(self.directive_value(d)),
                            Member::Text { text, .. } => children.push(js_string(text)),
                            Member::Expr { expr, .. } => children.push(format!("() => {expr}")),
                            _ => {}
                        }
                    }
                    let children_str = if children.is_empty() {
                        "[]".to_string()
                    } else {
                        format!("[{}]", children.join(","))
                    };
                    values.push(format!("__dml_macro__({:?},{:?},{})", m.name, m.head_src, children_str));
                }
                Member::Attribute { .. } | Member::NamespaceScope { .. } => {}
            }
        }
        format!("[{}]", values.join(","))
    }

    /// Emit one child member: element → nested shape, text → string node,
    /// expression/directive → placeholder + insert binding.
    fn child(&mut self, m: &Member, in_svg: bool, out: &mut Vec<String>) {
        match m {
            Member::Element(el) => out.push(self.element(el, in_svg)),
            Member::Text { text, .. } => {
                self.take_index();
                out.push(js_string(text));
            }
            Member::Expr { expr, .. } => {
                let idx = self.take_index();
                self.helpers.insert(H_INSERT);
                out.push("\"\"".to_string());
                self.bindings
                    .push(format!("_$insert({NODES}[{idx}],() => {expr})"));
            }
            Member::Directive(d) => {
                let idx = self.take_index();
                self.helpers.insert(H_INSERT);
                out.push("\"\"".to_string());
                let value = self.directive_value(d);
                self.bindings.push(format!("_$insert({NODES}[{idx}],{value})"));
            }
            Member::Sequence(items) => {
                for it in items {
                    self.child(it, in_svg, out);
                }
            }
            // `@slot("name") { fallback }` — a slot outlet. The caller's
            // subtree arrives as `props.name`, so bind that (with the fallback
            // used when the caller passed nothing).
            //
            // The fallback must be *instantiated nodes*, not shape data: the
            // caller's array already holds real nodes (its own template), so a
            // plain shape array would render as nothing at all.
            Member::MacroCall(m) if m.name == "slot" => {
                if let Some((name, _)) = macro_slot_name(m) {
                    let idx = self.take_index();
                    self.helpers.insert(H_INSERT);
                    out.push("\"\"".to_string());
                    let fb = self.body_value(&m.body);
                    self.bindings
                        .push(format!("_$insert({NODES}[{idx}],(props.{name} ?? {fb}))"));
                } else {
                    self.macro_call_marker(m, in_svg, out);
                }
            }
            Member::MacroCall(m) => self.macro_call_marker(m, in_svg, out),
            Member::NamespaceScope { .. } | Member::Attribute { .. } => {}
        }
    }

    /// A macro component call as a marker the TypeScript transform intercepts.
    fn macro_call_marker(&mut self, m: &MacroCall, in_svg: bool, out: &mut Vec<String>) {
        let idx = self.take_index();
        self.helpers.insert(H_INSERT);
        out.push("\"\"".to_string());

        let mut children = Vec::new();
        for child in &m.body {
            self.child(child, in_svg, &mut children);
        }
        let children_str = if children.is_empty() {
            "[]".to_string()
        } else {
            format!("[{}]", children.join(","))
        };

        self.bindings.push(format!(
            "_$insert({NODES}[{idx}],__dml_macro__({:?},{:?},{}))",
            m.name, m.head_src, children_str
        ));
    }

    /// A component tag: `Counter { ... }`. Lowers to a direct call with a props
    /// object; dynamic props become getters so the component keeps tracking
    /// them, and element children become materialized nodes.
    fn component_value(&mut self, el: &Element) -> String {
        let mut props: Vec<String> = Vec::new();
        for m in &el.members {
            match m {
                Member::Attribute { name, value, .. } => {
                    if DIRECTIVES.contains(&name.as_str()) {
                        continue;
                    }
                    let key = js_string(name);
                    if let Some(literal) = literal_text(value) {
                        props.push(format!("{key}:{literal}"));
                        continue;
                    }
                    let text = value_text(value);
                    if is_dynamic(&text) {
                        props.push(format!("get {key}() {{ return {text} }}"));
                    } else {
                        props.push(format!("{key}:{text}"));
                    }
                }
                Member::NamespaceScope { prefix, inner } => {
                    for inner_m in inner {
                        if let Member::Attribute { name, value, .. } = inner_m {
                            let key = js_string(&format!("{prefix}:{name}"));
                            props.push(format!("{key}:{}", value_text(value)));
                        }
                    }
                }
                // `@template("name") { … }` — the subtree is passed as a named
                // prop, so the component decides where it lands.
                Member::MacroCall(mc) if mc.name == "template" => {
                    if let Some((name, _)) = macro_slot_name(mc) {
                        let mut kids = Vec::new();
                        for child in &mc.body {
                            match child {
                                Member::Element(el) => kids.push(self.template_expr(el)),
                                Member::Directive(d) => kids.push(self.directive_value(d)),
                                Member::Expr { expr, .. } => kids.push(format!("() => {expr}")),
                                Member::Text { text, .. } => kids.push(js_string(text)),
                                _ => {}
                            }
                        }
                        props.push(format!("{}:[{}]", js_string(&name), kids.join(",")));
                    }
                }
                _ => {}
            }
        }
        // Element children are materialized through their own template so the
        // component receives real nodes; directive blocks arrive as accessors,
        // which the runtime resolves in place.
        let mut kids: Vec<String> = Vec::new();
        for m in &el.members {
            match m {
                Member::Element(child) => kids.push(self.template_expr(child)),
                Member::Directive(d) => kids.push(self.directive_value(d)),
                Member::Expr { expr, .. } => kids.push(format!("() => {expr}")),
                Member::Text { text, .. } => kids.push(js_string(text)),
                Member::Sequence(items) => {
                    for it in items {
                        match it {
                            Member::Element(child) => kids.push(self.template_expr(child)),
                            Member::Directive(d) => kids.push(self.directive_value(d)),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        if !kids.is_empty() {
            props.push(format!("children:[{}]", kids.join(",")));
        }
        format!("{}({{{}}})", el.name, props.join(","))
    }

    /// A component in a child position: instantiate a placeholder text node and
    /// insert the component's node in front of it.
    fn component(&mut self, el: &Element, idx: usize) -> String {
        let call = self.component_value(el);
        self.helpers.insert(H_INSERT);
        self.bindings
            .push(format!("_$insert({NODES}[{idx}],{call})"));
        "\"\"".to_string()
    }
}

/// `Counter` / `My.Widget` → a component, not a host element.
pub(crate) fn is_component(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// Attribute names that are never DOM/component props: the control-flow
/// directive words (a `@if:`-as-attribute is a parse error, kept out of props
/// defensively).
const DIRECTIVES: [&str; 4] = ["if", "for", "as", "key"];

/// The slot name of a `@template("name")` / `@slot("name")` macro call, with
/// the span of the name *inside* the quotes (for editor completion/hover).
///
/// The head is kept as raw source, so the string is unwrapped here. `head_span`
/// starts at `(`, so the content begins at `head_span.start + 1` and the name
/// one byte later (past the opening quote).
pub(crate) fn macro_slot_name(m: &MacroCall) -> Option<(String, Option<Span>)> {
    if m.name != "template" && m.name != "slot" {
        return None;
    }
    let src = m.head_src.trim();
    let inner = src.strip_prefix('"')?.strip_suffix('"')?;
    if inner.is_empty() {
        return None;
    }
    // offset of the name within head_src (leading quote + any padding)
    let lead = src.len() - src.trim_start_matches('"').len();
    let span = m.head_span.map(|hs| Span {
        start: hs.start + 1 + lead,
        end: hs.start + 1 + lead + inner.len(),
        line: hs.line,
        // slot names are single-line; shift past `(` + the opening quote
        col: hs.col + 2 + lead as u32,
    });
    Some((inner.to_string(), span))
}



/// `@onClick: handler` — an event binding. Only expressions can be handlers;
/// a literal value stays a plain prop (matching the typed IR's behaviour).
fn is_event(name: &str, value: &DmlValue) -> bool {
    name.len() > 2
        && name.starts_with("on")
        && matches!(value, DmlValue::Bare(_) | DmlValue::Expr(_))
}

/// Anything that can change at runtime: a call, a member access or a template
/// interpolation. Plain identifiers (imports, constants) and literals are
/// applied once.
///
/// Conservative by construction: an identifier used where a signal accessor is
/// expected must be *called* (`count()`, `count.read()`), which is a call and
/// therefore dynamic. This keeps the split sound without type information.
fn is_dynamic(text: &str) -> bool {
    text.contains('(') || text.contains('.') || text.contains("${")
}

fn literal_text(v: &DmlValue) -> Option<String> {
    match v {
        DmlValue::String(s) => Some(js_string(s)),
        DmlValue::Number(n) => Some(format_number(*n)),
        DmlValue::Boolean(b) => Some(b.to_string()),
        DmlValue::Null => Some("null".to_string()),
        _ => None,
    }
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Verbatim JS for non-literal values (identifiers, calls, arrays, objects).
fn value_text(v: &DmlValue) -> String {
    match v {
        DmlValue::String(s) => js_string(s),
        DmlValue::Number(n) => format_number(*n),
        DmlValue::Boolean(b) => b.to_string(),
        DmlValue::Null => "null".to_string(),
        DmlValue::Bare(b) => b.clone(),
        DmlValue::Expr(e) => e.clone(),
        DmlValue::Array(items) => {
            let inner: Vec<String> = items.iter().map(value_text).collect();
            format!("[{}]", inner.join(","))
        }
        DmlValue::Object(pairs) => {
            let inner: Vec<String> = pairs
                .iter()
                .map(|(k, v)| format!("{}:{}", js_string(k), value_text(v)))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

/// Escape a Rust string into a JS double-quoted string literal.
///
/// Rust's `{:?}` is not a JS escaper (`\u{7f}` is not valid JS), so the
/// optimizing backend uses this for every literal it embeds.
pub fn js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(name: &str, members: Vec<Member>) -> Element {
        Element {
            name: name.to_string(),
            members,
            span: None,
        }
    }
    fn attr(name: &str, value: DmlValue) -> Member {
        Member::Attribute {
            name: name.to_string(),
            value,
            name_span: None,
            value_span: None,
        }
    }
    fn text(t: &str) -> Member {
        Member::Text {
            text: t.to_string(),
            span: None,
        }
    }
    fn expr(e: &str) -> Member {
        Member::Expr {
            expr: e.to_string(),
            span: None,
        }
    }
    fn doc(root: Element) -> Document {
        Document { root }
    }

    /// `@if (cond) { body }` as an AST node.
    fn if_block(cond: &str, body: Vec<Member>) -> Member {
        Member::Directive(Directive {
            kind: DirectiveKind::If {
                cond: DmlValue::Expr(cond.to_string()),
                cond_span: None,
                otherwise: None,
            },
            body,
            span: None,
        })
    }

    /// `@for (var of iter) { @key: key; body }` as an AST node.
    fn for_block(var: &str, iter: &str, key: Option<DmlValue>, body: Vec<Member>) -> Member {
        let mut full_body = body;
        if let Some(key_expr) = key {
            full_body.insert(
                0,
                Member::Attribute {
                    name: "key".to_string(),
                    value: key_expr,
                    name_span: None,
                    value_span: None,
                },
            );
        }
        Member::Directive(Directive {
            kind: DirectiveKind::For {
                var: var.to_string(),
                var_span: None,
                iter: DmlValue::Expr(iter.to_string()),
                iter_span: None,
            },
            body: full_body,
            span: None,
        })
    }

    #[test]
    fn empty_element_hoists_template() {
        let out = generate_module(&doc(el("div", vec![])), 0);
        assert_eq!(out.shape, r#"["div",null,null]"#);
        assert_eq!(out.prelude, r#"const _$t0 = _$template(["div",null,null]);"#);
        assert_eq!(out.expr, "_$t0()[0]");
        assert_eq!(out.helpers, vec!["template"]);
    }

    #[test]
    fn literal_props_live_in_the_shape() {
        let out = generate_module(
            &doc(el(
                "button",
                vec![attr("class", DmlValue::String("btn".into())), text("click")],
            )),
            0,
        );
        assert_eq!(out.shape, r#"["button",{"class":"btn"},["click"]]"#);
        assert_eq!(out.expr, "_$t0()[0]");
    }

    #[test]
    fn static_identifier_prop_is_applied_once() {
        let out = generate_module(
            &doc(el("img", vec![attr("src", DmlValue::Bare("heroImg".into()))])),
            0,
        );
        // image is not in the shape; it is set once after instantiation
        assert_eq!(out.shape, r#"["img",null,null]"#);
        assert_eq!(
            out.expr,
            "(() => { const _n$ = _$t0(); _$setProp(_n$[0],\"src\",heroImg); return _n$[0] })()"
        );
        assert!(out.helpers.contains(&"setProp".to_string()));
    }

    #[test]
    fn dynamic_prop_becomes_reactive() {
        let out = generate_module(
            &doc(el("span", vec![attr("class", DmlValue::Expr("cls()".into()))])),
            0,
        );
        assert_eq!(
            out.expr,
            "(() => { const _n$ = _$t0(); _$setPropReactive(_n$[0],\"class\",() => cls()); return _n$[0] })()"
        );
        assert!(out.helpers.contains(&"setPropReactive".to_string()));
    }

    #[test]
    fn member_access_is_dynamic() {
        let out = generate_module(
            &doc(el("span", vec![attr("class", DmlValue::Bare("props.cls".into()))])),
            0,
        );
        assert!(out.expr.contains("_$setPropReactive"));
    }

    #[test]
    fn event_binding_is_never_reactive() {
        let out = generate_module(
            &doc(el(
                "button",
                vec![attr("onClick", DmlValue::Bare("increment".into()))],
            )),
            0,
        );
        assert_eq!(
            out.expr,
            "(() => { const _n$ = _$t0(); _$on(_n$[0],\"onClick\",increment); return _n$[0] })()"
        );
        assert!(out.helpers.contains(&"on".to_string()));
    }

    #[test]
    fn expr_child_inserts_at_its_placeholder_index() {
        // div (0) → ["Count is " (1), placeholder (2)]
        let out = generate_module(
            &doc(el("div", vec![text("Count is "), expr("count.read()")])),
            0,
        );
        assert_eq!(out.shape, r#"["div",null,["Count is ",""]]"#);
        assert_eq!(
            out.expr,
            "(() => { const _n$ = _$t0(); _$insert(_n$[2],() => count.read()); return _n$[0] })()"
        );
    }

    #[test]
    fn nested_elements_are_indexed_in_preorder() {
        // div(0) → section(1) → button(2)
        let out = generate_module(
            &doc(el(
                "div",
                vec![Member::Element(el(
                    "section",
                    vec![Member::Element(el(
                        "button",
                        vec![attr("onClick", DmlValue::Bare("inc".into()))],
                    ))],
                ))],
            )),
            0,
        );
        assert_eq!(out.shape, r#"["div",null,[["section",null,[["button",null,null]]]]]"#);
        assert!(out.expr.contains("_$on(_n$[2],\"onClick\",inc)"));
    }

    #[test]
    fn svg_subtree_flags_reactive_props() {
        let out = generate_module(
            &doc(el(
                "svg",
                vec![Member::Element(el(
                    "use",
                    vec![attr("href", DmlValue::Expr("url()".into()))],
                ))],
            )),
            0,
        );
        assert!(out.expr.contains("_$setPropReactive(_n$[1],\"href\",() => url(),true)"));
    }

    /// `@template("name") { … }` as an AST node.
    fn template_call(name: &str, body: Vec<Member>) -> Member {
        Member::MacroCall(MacroCall {
            name: "template".into(),
            name_span: None,
            head_src: format!("{name:?}"),
            head_span: None,
            body,
            span: None,
        })
    }

    /// `@slot("name") { fallback }` as an AST node.
    fn slot_outlet(name: &str, fallback: Vec<Member>) -> Member {
        Member::MacroCall(MacroCall {
            name: "slot".into(),
            name_span: None,
            head_src: format!("{name:?}"),
            head_span: None,
            body: fallback,
            span: None,
        })
    }

    #[test]
    fn template_call_reaches_the_component_as_a_named_prop() {
        let out = generate_module(
            &doc(el(
                "Panel",
                vec![
                    attr("title", DmlValue::String("demo".into())),
                    template_call("footer", vec![Member::Element(el("span", vec![text("x")]))]),
                ],
            )),
            0,
        );
        assert!(
            out.expr.contains("\"footer\":["),
            "footer prop missing from {}",
            out.expr
        );
        assert!(out.expr.contains("\"title\":\"demo\""));
    }

    #[test]
    fn slot_outlet_falls_back_when_the_caller_passed_nothing() {
        let out = generate_module(
            &doc(el(
                "section",
                vec![slot_outlet(
                    "footer",
                    vec![Member::Element(el("footer", vec![text("none")]))],
                )],
            )),
            0,
        );
        assert!(
            out.expr.contains("props.footer ??"),
            "slot outlet missing from {}",
            out.expr
        );
        // the fallback must be *instantiated nodes* (a hoisted template call),
        // not a bare shape array: the caller's `props.footer` already holds
        // real nodes, and a shape array would render as nothing.
        assert!(
            out.expr.contains("?? [_$t"),
            "fallback is not a node instantiation: {}",
            out.expr
        );
    }

    #[test]
    fn component_lowers_to_a_direct_call() {
        let out = generate_module(
            &doc(el(
                "Counter",
                vec![
                    attr("step", DmlValue::Number(2.0)),
                    attr("onTick", DmlValue::Bare("onTick".into())),
                    attr("label", DmlValue::Expr("props.label".into())),
                ],
            )),
            0,
        );
        // props object: literal, plain identifier, and a getter for the dynamic one
        assert_eq!(
            out.expr,
            "Counter({\"step\":2,\"onTick\":onTick,get \"label\"() { return props.label }})"
        );
        // a component root needs no template at all
        assert_eq!(out.prelude, "");
        assert!(out.helpers.is_empty());
    }

    #[test]
    fn component_children_are_materialized() {
        let out = generate_module(
            &doc(el(
                "Panel",
                vec![Member::Element(el("span", vec![text("hi")]))],
            )),
            0,
        );
        assert_eq!(out.expr, "Panel({children:[_$t0()[0]]})");
        assert!(out.prelude.contains("_$t0 = _$template([\"span\",null,[\"hi\"]])"));
    }

    #[test]
    fn if_block_is_an_accessor_over_its_body() {
        // div(0) → placeholder(1); the block's body is built lazily
        let out = generate_module(
            &doc(el(
                "div",
                vec![if_block("cond", vec![Member::Element(el("span", vec![text("hi")]))])],
            )),
            0,
        );
        assert!(
            out.expr.contains("_$insert(_n$[1],() => (cond) ? [_$t0_1()[0]] : null)"),
            "{}",
            out.expr
        );
        // the body's element gets its own hoisted template
        assert!(out.prelude.contains("_$t0_1"), "{}", out.prelude);
        // `@if` needs no runtime state, so no `each` helper
        assert!(out.helpers.contains(&"insert".to_string()));
        assert!(!out.helpers.contains(&"each".to_string()));
    }

    #[test]
    fn if_block_renders_several_siblings() {
        let out = generate_module(
            &doc(el(
                "div",
                vec![if_block(
                    "ok",
                    vec![
                        Member::Element(el("b", vec![text("a")])),
                        Member::Element(el("i", vec![text("b")])),
                    ],
                )],
            )),
            0,
        );
        // both elements are members of ONE body array → one directive, two nodes
        assert!(
            out.expr
                .contains("() => (ok) ? [_$t0_1()[0],_$t0_2()[0]] : null)"),
            "{}",
            out.expr
        );
    }

    #[test]
    fn else_arms_chain_into_one_accessor() {
        let mut block = if_block("a", vec![text("A")]);
        if let Member::Directive(d) = &mut block {
            if let DirectiveKind::If { otherwise, .. } = &mut d.kind {
                let mut second = if_block("b", vec![text("B")]);
                if let Member::Directive(d2) = &mut second {
                    if let DirectiveKind::If { otherwise: o2, .. } = &mut d2.kind {
                        *o2 = Some(ElseArm::Block {
                            body: vec![text("C")],
                            span: None,
                        });
                    }
                }
                *otherwise = Some(ElseArm::If(Box::new(match second {
                    Member::Directive(d2) => d2,
                    _ => unreachable!(),
                })));
            }
        }
        let out = generate_module(&doc(el("div", vec![block])), 0);
        assert!(
            out.expr.contains(") => (a) ? [\"A\"] : (b) ? [\"B\"] : [\"C\"] : null)"),
            "{}",
            out.expr
        );
    }

    #[test]
    fn unkeyed_for_block_is_a_map_accessor() {
        let out = generate_module(
            &doc(el(
                "ul",
                vec![for_block("it", "items", None, vec![expr("it.label")])],            )),
            0,
        );
        assert!(
            out.expr
                .contains("_$insert(_n$[1],() => Array.from(items).map((it) => [() => it.label]))"),
            "{}",
            out.expr
        );
        assert!(!out.helpers.contains(&"each".to_string()));
    }

    #[test]
    fn keyed_for_block_uses_the_runtime_helper() {
        let out = generate_module(
            &doc(el(
                "ul",
                vec![for_block("it", "items", Some(DmlValue::Expr("it.id".into())), vec![expr("it.label")])],
            )),
            0,
        );
        assert!(out.helpers.contains(&"each".to_string()), "{:?}", out.helpers);
        assert!(
            out.expr
                .contains("_$insert(_n$[1],_$each(() => items,(it) => [() => it.label],(it) => it.id))"),
            "{}",
            out.expr
        );
    }

    #[test]
    fn component_children_can_carry_directives() {
        let out = generate_module(
            &doc(el(
                "Panel",
                vec![if_block("cond", vec![Member::Element(el("span", vec![text("x")]))])],
            )),
            0,
        );
        // the component receives an accessor child, which `insert` resolves
        assert!(
            out.expr.contains("children:[() => (cond) ? ["),
            "{}",
            out.expr
        );
    }

    #[test]
    fn escapes_are_js_safe() {
        let out = generate_module(
            &doc(el("p", vec![text("a\"b\\c\nd\u{7}")])),
            0,
        );
        assert_eq!(out.shape, r#"["p",null,["a\"b\\c\nd\u0007"]]"#);
    }
}
