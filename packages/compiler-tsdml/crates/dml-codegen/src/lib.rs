//! dml-codegen —turn a DML-AST into framework runtime calls.
//!
//! Responsibility: consume `dml_ast::Document` and emit the "runtime
//! invocation" source the DML-Framework executes —the `e(tag, props,
//! children)` call shape. This is the TSDML lowering core.
//!
//! `generate_document_with_spans` additionally returns a `NodeSpan` per
//! span-able AST fragment: the fragment's raw byte span (recorded by the
//! parser on the AST) paired with the byte span of its lowered text in the
//! output. One traversal produces both, so the map can never drift —this is
//! the authoritative raw↔lowered map the editor (Volar) uses for hover,
//! completion, go-to-definition and diagnostics.

use dml_ast::{
    Directive, DirectiveKind, Document, DmlValue, Element, ElseArm, MacroCall, Member, NodeSpan,
    SpanRole,
};

pub mod module;

pub use module::{generate_module, ModuleOutput};

/// Runtime call helper used by the typed IR.
///
/// A reserved name: the editor transform injects the binding (`declare const
/// __dml_e: E`) into its snapshot prologue, so user code never declares a
/// renderer argument.
pub const RUNTIME_FN: &str = "__dml_e";

/// Emit a complete runtime call expression for a DML document.
pub fn generate_document(doc: &Document) -> String {
    generate_document_with_spans(doc).0
}

/// Emit a complete runtime call expression plus a node map: every span-able
/// AST fragment →(raw span, lowered span).
pub fn generate_document_with_spans(doc: &Document) -> (String, Vec<NodeSpan>) {
    let mut sink = Sink {
        out: String::new(),
        spans: Vec::new(),
    };
    sink.element(&doc.root);
    (sink.out, sink.spans)
}

struct Sink {
    out: String,
    spans: Vec<NodeSpan>,
}

/// A pending span to record once the lowered text position is known.
impl Sink {
    fn raw(&mut self, s: &str) {
        self.out.push_str(s);
    }

    fn record(&mut self, role: SpanRole, raw: Option<(usize, usize)>, start: usize, end: usize) {
        if let Some((rs, re)) = raw {
            self.spans.push(NodeSpan {
                role,
                raw: (rs, re),
                lowered: (start, end),
            });
        }
    }

    /// A control-flow block as a **value** (typed IR): a TS conditional, or
    /// `Array.from(items).map((item) => …)`, whose result is the body's members
    /// as an array. Condition, iterable, loop binding and key are all real TS,
    /// so the language service type-checks them exactly as it would in `.ts`.
    ///
    /// The loop binding is recorded with `SpanRole::LoopVar`: it is the arrow
    /// parameter TS declares, so hover/rename on it work in the template.
    fn directive(&mut self, d: &Directive) {
        match &d.kind {
            DirectiveKind::If { .. } => self.if_chain(d),
            DirectiveKind::For {
                var,
                var_span,
                iter,
                iter_span,
            } => {
                // Extract @key from body if present
                let key_attr = d.body.iter().find_map(|m| {
                    if let Member::Attribute { name, value, value_span, .. } = m {
                        if name == "key" {
                            return Some((value.clone(), *value_span));
                        }
                    }
                    None
                });

                self.raw("Array.from(");
                self.value_span(iter, *iter_span);
                self.raw(").map((");
                let start = self.out.len();
                self.raw(var);
                self.record(
                    SpanRole::LoopVar,
                    var_span.map(|s| (s.start, s.end)),
                    start,
                    start + var.len(),
                );
                self.raw(") => ");
                
                // If there's a key, wrap body in tuple: (key, body)
                if let Some((key_val, key_span)) = key_attr {
                    self.raw("(");
                    self.value_span(&key_val, key_span);
                    self.raw(", ");
                    self.body(&d.body);
                    self.raw(")");
                } else {
                    self.body(&d.body);
                }
                
                self.raw(")");
            }
        }
    }

    /// `cond ? body : cond2 ? body2 : elseBody` (nested, parenthesized).
    fn if_chain(&mut self, d: &Directive) {
        let DirectiveKind::If {
            cond,
            cond_span,
            otherwise,
        } = &d.kind
        else {
            return;
        };
        self.raw("(");
        self.value_span(cond, *cond_span);
        self.raw(" ? ");
        self.body(&d.body);
        match otherwise {
            None => self.raw(" : null"),
            Some(ElseArm::Block { body, .. }) => {
                self.raw(" : ");
                self.body(body);
            }
            Some(ElseArm::If(chain)) => {
                self.raw(" : ");
                self.if_chain(chain);
            }
        }
        self.raw(")");
    }

    /// The members of a block as one array value (`[ node, "text", () => expr ]`).
    fn body(&mut self, body: &[Member]) {
        self.raw("[ ");
        let mut first = true;
        for m in body {
            match m {
                Member::Attribute { .. } | Member::NamespaceScope { .. } => continue,
                Member::Sequence(items) => {
                    for it in items {
                        if first {
                            first = false;
                        } else {
                            self.raw(", ");
                        }
                        self.member_value(it);
                    }
                }
                other => {
                    if first {
                        first = false;
                    } else {
                        self.raw(", ");
                    }
                    self.member_value(other);
                }
            }
        }
        self.raw(" ]");
    }

    /// One member of a directive body as a value.
    fn member_value(&mut self, m: &Member) {
        match m {
            Member::Element(el) => self.element(el),
            Member::Text { text, span } => {
                let start = self.out.len();
                let t = format!("{text:?}");
                self.raw(&t);
                self.record(
                    SpanRole::Text,
                    span.map(|s| (s.start, s.end)),
                    start,
                    start + t.len(),
                );
            }
            // `{ expr }` is a thunk in both backends: the runtime re-evaluates it
            Member::Expr { expr, span } => {
                self.raw("() => ");
                let start = self.out.len();
                self.raw(expr);
                self.record(
                    SpanRole::Expr,
                    span.map(|s| (s.start, s.end)),
                    start,
                    start + expr.len(),
                );
            }
            Member::Directive(inner) => self.directive(inner),
            Member::MacroCall(m) if m.name == "slot" => match crate::module::macro_slot_name(m) {
                Some((name, span)) => self.slot_outlet(&name, span, &m.body),
                None => self.macro_call_marker(m),
            },
            Member::MacroCall(m) => self.macro_call_marker(m),
            Member::Sequence(_) => {}
            Member::Attribute { .. } | Member::NamespaceScope { .. } => {}
        }
    }

    /// Emit one attribute value verbatim, recording its raw↔lowered span.
    fn value_span(&mut self, value: &DmlValue, raw: Option<dml_ast::Span>) {
        let start = self.out.len();
        let text = Self::value_text(value);
        self.raw(&text);
        self.record(
            SpanRole::Expr,
            raw.map(|s| (s.start, s.end)),
            start,
            start + text.len(),
        );
    }

    /// Emit one element (recursive): `__dml_e("tag", {props}, children)`.
    ///
    /// A Capitalized tag is a **component** and lowers to a direct call
    /// (`Counter({ ...props })`) instead — see [`Sink::component`].
    fn element(&mut self, el: &Element) {
        if crate::module::is_component(&el.name) {
            self.component(el);
            return;
        }
        let tag_raw = el.span.map(|s| (s.start, s.end));
        let tag_text = format!("{:?}", el.name);

        let mut attr_spans: Vec<(SpanRole, Option<(usize, usize)>)> = Vec::new();
        // gather attribute (name/value) raw spans in member order (directives
        // such as `@if` / `@for` / `@key` are not props)
        let mut attrs: Vec<&Member> = Vec::new();
        for m in &el.members {
            if let Member::Attribute {
                name,
                name_span,
                value_span,
                ..
            } = m
            {
                if DIRECTIVE_NAMES.contains(&name.as_str()) {
                    continue;
                }
                attrs.push(m);
                attr_spans.push((
                    SpanRole::AttrName,
                    name_span.map(|s| (s.start, s.end)),
                ));
                attr_spans.push((
                    SpanRole::AttrValue,
                    value_span.map(|s| (s.start, s.end)),
                ));
            }
        }
        let has_children = el
            .members
            .iter()
            .any(|m| !matches!(m, Member::Attribute { .. }));

        self.raw(&format!("{RUNTIME_FN}("));
        let tag_start = self.out.len();
        self.raw(&tag_text);
        // lowered tag span = the name INSIDE the quotes, same length as raw
        self.record(
            SpanRole::Tag,
            tag_raw,
            tag_start + 1,
            tag_start + 1 + el.name.len(),
        );

        if attrs.is_empty() && !has_children {
            self.raw(")");
            return;
        }

        // props object
        if attrs.is_empty() {
            self.raw(", null");
        } else {
            self.raw(", { ");
            let mut first = true;
            for (i, m) in attrs.iter().enumerate() {
                if !first {
                    self.raw(", ");
                }
                first = false;
                if let Member::Attribute { name, value, .. } = m {
                    let key_text = format!("{name:?}");
                    let key_start = self.out.len();
                    self.raw(&key_text);
                    self.record(
                        SpanRole::AttrName,
                        attr_spans[i * 2].1,
                        key_start + 1,
                        key_start + 1 + name.len(),
                    );
                    self.raw(": ");
                    let val_start = self.out.len();
                    let val_text = Self::value_text(value);
                    self.raw(&val_text);
                    self.record(
                        SpanRole::AttrValue,
                        attr_spans[i * 2 + 1].1,
                        val_start,
                        val_start + val_text.len(),
                    );
                }
            }
            self.raw(" }");
        }

        // children
        if has_children {
            let child_members: Vec<&Member> = el
                .members
                .iter()
                .filter(|m| !matches!(m, Member::Attribute { .. }))
                .collect();
            if child_members.len() == 1 {
                self.raw(", ");
                self.child(child_members[0]);
            } else {
                self.raw(", [ ");
                let mut first = true;
                for m in child_members {
                    if !first {
                        self.raw(", ");
                    }
                    first = false;
                    self.child(m);
                }
                self.raw(" ]");
            }
        }
        self.raw(")");
    }

    /// Emit a component call (typed IR): `Counter({ "prop": value, children: [...] })`.
    ///
    /// The props object is what the TypeScript service type-checks: prop names
    /// come from the component's declared props type, so completion / hover /
    /// go-to-definition on the tag AND on every prop are TS-native (the same
    /// reason the element IR uses `e(tag, props, children)`).
    fn component(&mut self, el: &Element) {
        // Tag: a TS identifier → TS owns hover/navigation/completion.
        let tag_start = self.out.len();
        self.raw(&el.name);
        self.record(
            SpanRole::ComponentTag,
            el.span.map(|s| (s.start, s.end)),
            tag_start,
            tag_start + el.name.len(),
        );
        // Props: plain attributes plus namespaced scopes (`@ns: { k: v }`).
        // Directives (`@if`, `@for`, `@key`) are not props.
        let mut props: Vec<(String, &DmlValue, Option<dml_ast::Span>, Option<dml_ast::Span>)> =
            Vec::new();
        for m in &el.members {
            match m {
                Member::Attribute {
                    name,
                    value,
                    name_span,
                    value_span,
                } => {
                    if DIRECTIVE_NAMES.contains(&name.as_str()) {
                        continue;
                    }
                    props.push((name.clone(), value, *name_span, *value_span))
                }
                Member::NamespaceScope { prefix, inner } => {
                    for inner_m in inner {
                        if let Member::Attribute {
                            name,
                            value,
                            name_span,
                            value_span,
                        } = inner_m
                        {
                            props.push((
                                format!("{prefix}:{name}"),
                                value,
                                *name_span,
                                *value_span,
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        self.raw("({");

        let mut wrote_part = false;
        for (name, value, name_span, value_span) in props {
            if wrote_part {
                self.raw(", ");
            } else {
                self.raw(" ");
            }
            wrote_part = true;
            let key_start = self.out.len();
            self.raw(&format!("{name:?}"));
            self.record(
                SpanRole::ComponentAttrName,
                name_span.map(|s| (s.start, s.end)),
                key_start + 1,
                key_start + 1 + name.len(),
            );
            self.raw(": ");
            let value_start = self.out.len();
            let text = Self::value_text(value);
            self.raw(&text);
            self.record(
                SpanRole::ComponentAttrValue,
                value_span.map(|s| (s.start, s.end)),
                value_start,
                value_start + text.len(),
            );
        }

        // Children are forwarded as a `children` key (element children recurse,
        // `{ expr }` children stay thunks). A `@template("name") { … }` block
        // becomes a named prop instead, so the component decides where it lands.
        let mut template_slots: Vec<(String, Option<dml_ast::Span>, &MacroCall)> = Vec::new();
        let mut positional: Vec<&Member> = Vec::new();
        for m in &el.members {
            match m {
                Member::MacroCall(mc) => match crate::module::macro_slot_name(mc) {
                    Some((name, span)) if mc.name == "template" => {
                        template_slots.push((name, span, mc))
                    }
                    _ => positional.push(m),
                },
                Member::Attribute { .. } | Member::NamespaceScope { .. } => {}
                other => positional.push(other),
            }
        }

        // `@template("name") { … }` — the subtree is passed as a named prop.
        for (name, span, mc) in &template_slots {
            if wrote_part {
                self.raw(", ");
            } else {
                self.raw(" ");
            }
            wrote_part = true;
            let key_start = self.out.len();
            self.raw(&format!("{name:?}"));
            self.record(
                SpanRole::ComponentAttrName,
                span.map(|s| (s.start, s.end)),
                key_start + 1,
                key_start + 1 + name.len(),
            );
            self.record(
                SpanRole::SlotName,
                span.map(|s| (s.start, s.end)),
                key_start + 1,
                key_start + 1 + name.len(),
            );
            self.raw(": [ ");
            let mut first = true;
            for child in &mc.body {
                if !first {
                    self.raw(", ");
                }
                first = false;
                self.child(child);
            }
            self.raw(" ]");
        }

        if !positional.is_empty() {
            if wrote_part {
                self.raw(", ");
            } else {
                self.raw(" ");
            }
            wrote_part = true;
            self.raw("children: [ ");
            let mut first_child = true;
            for m in positional {
                if !first_child {
                    self.raw(", ");
                }
                first_child = false;
                self.child(m);
            }
            self.raw(" ]");
        }
        self.raw(if wrote_part { " })" } else { "})" });
    }

    /// Emit one child member's lowered text with its span (if any).
    fn child(&mut self, m: &Member) {
        match m {
            Member::Element(e) => {
                // span recorded inside element() for the nested tag
                self.element(e);
            }
            Member::Text { text, span } => {
                let start = self.out.len();
                let t = format!("{text:?}");
                self.raw(&t);
                self.record(
                    SpanRole::Text,
                    span.map(|s| (s.start, s.end)),
                    start,
                    start + t.len(),
                );
            }
            Member::Expr { expr, span } => {
                // reactive binding →thunk `() => expr`; span maps to the expr
                // text only (editor navigates the expression itself)
                self.raw("() => ");
                let e_start = self.out.len();
                self.raw(expr);
                self.record(
                    SpanRole::Expr,
                    span.map(|s| (s.start, s.end)),
                    e_start,
                    e_start + expr.len(),
                );
            }
            Member::Sequence(items) => {
                // a sequence child is already rendered as an array by the
                // caller; here just emit each item (should not normally occur)
                for it in items {
                    self.child(it);
                }
            }
            // a control-flow block is a value: the runtime resolves it in place
            Member::Directive(d) => self.directive(d),
            // `@slot("name") { fallback }` — a slot outlet: render what the
            // caller passed as `props.name`, else the fallback body.
            Member::MacroCall(m) if m.name == "slot" => {
                match crate::module::macro_slot_name(m) {
                    Some((name, span)) => self.slot_outlet(&name, span, &m.body),
                    None => self.macro_call_marker(m),
                }
            }
            // a macro component call is a value: the runtime resolves it in place
            Member::MacroCall(m) => self.macro_call_marker(m),
            _ => {}
        }
    }

    /// A slot outlet: `(props.name ?? [ fallback… ])`.
    ///
    /// The caller supplies `props.name` (an array, from `@template("name")`);
    /// `??` picks the fallback only when nothing was passed, so an empty array
    /// from the caller still wins over the fallback.
    fn slot_outlet(&mut self, name: &str, name_span: Option<dml_ast::Span>, fallback: &[Member]) {
        let start = self.out.len();
        self.raw(&format!("(props.{name} ?? ["));
        self.record(
            SpanRole::SlotName,
            name_span.map(|s| (s.start, s.end)),
            start + "(props.".len(),
            start + "(props.".len() + name.len(),
        );
        let mut first = true;
        for child in fallback {
            if !first {
                self.raw(", ");
            }
            first = false;
            self.child(child);
        }
        self.raw("])");
    }

    /// Emit a macro component call as a marker the TypeScript transform
    /// intercepts: `__dml_macro__("name", "headSrc", [children])`.
    fn macro_call_marker(&mut self, m: &MacroCall) {
        self.raw("__dml_macro__(");
        self.raw(&format!("{:?}", m.name));
        self.raw(", ");
        self.raw(&format!("{:?}", m.head_src));
        self.raw(", [");
        let mut first = true;
        for child in &m.body {
            if !first {
                self.raw(", ");
            }
            first = false;
            self.child(child);
        }
        self.raw("])");
    }

    /// Render a DmlValue literal (no span bookkeeping — used inside props).
    fn value_text(v: &DmlValue) -> String {
        match v {
            DmlValue::String(s) => format!("{s:?}"),
            DmlValue::Number(n) => format!("{n}"),
            DmlValue::Boolean(b) => format!("{b}"),
            DmlValue::Null => "null".to_string(),
            DmlValue::Bare(b) => b.clone(),
            DmlValue::Expr(e) => e.clone(),
            DmlValue::Array(items) => {
                let inner: Vec<String> = items.iter().map(Self::value_text).collect();
                format!("[ {} ]", inner.join(", "))
            }
            DmlValue::Object(pairs) => {
                let inner: Vec<String> = pairs
                    .iter()
                    .map(|(k, v)| format!("{k:?}: {}", Self::value_text(v)))
                    .collect();
                format!("{{ {} }}", inner.join(", "))
            }
        }
    }
}

/// Attribute names that are never props (control-flow words).
const DIRECTIVE_NAMES: [&str; 4] = ["if", "for", "as", "key"];

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

    #[test]
    fn generates_empty_element() {
        let doc = Document { root: el("div", vec![]) };
        assert_eq!(generate_document(&doc), r#"__dml_e("div")"#);
    }

    #[test]
    fn generates_attrs_and_text() {
        let doc = Document {
            root: el(
                "button",
                vec![attr("class", DmlValue::String("btn".into())), text("click")],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"__dml_e("button", { "class": "btn" }, "click")"#
        );
    }

    #[test]
    fn generates_children() {
        let doc = Document {
            root: el(
                "div",
                vec![Member::Element(el("p", vec![text("hi")]))],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"__dml_e("div", null, __dml_e("p", null, "hi"))"#
        );
    }

    #[test]
    fn multiple_children_sequence() {
        let doc = Document {
            root: el(
                "div",
                vec![
                    Member::Element(el("a", vec![])),
                    Member::Element(el("b", vec![])),
                ],
            ),
        };
        assert_eq!(
            generate_document(&doc),
            r#"__dml_e("div", null, [ __dml_e("a"), __dml_e("b") ])"#
        );
    }

    #[test]
    fn expr_child_is_thunk() {
        let doc = Document {
            root: el("span", vec![expr("count()")]),
        };
        assert_eq!(generate_document(&doc), r#"__dml_e("span", null, () => count())"#);
    }

    #[test]
    fn expr_attr_is_verbatim() {
        let doc = Document {
            root: el(
                "span",
                vec![attr("class", DmlValue::Expr("cls()".into()))],
            ),
        };
        assert_eq!(generate_document(&doc), r#"__dml_e("span", { "class": cls() })"#);
    }

    #[test]
    fn spans_cover_fragments() {
        // build an AST with raw spans hand-set, then check the emitted NodeSpans
        let mut root = el("div", vec![]);
        root.span = Some(span(0, 3));
        let mut img = el("img", vec![]);
        img.span = Some(span(6, 9));
        let mut button = el("button", vec![]);
        button.span = Some(span(20, 26));
        let mut attr_src = attr("src", DmlValue::Bare("hero".into()));
        if let Member::Attribute {
            name_span,
            value_span,
            ..
        } = &mut attr_src
        {
            *name_span = Some(span(13, 16));
            *value_span = Some(span(18, 22));
        }
        img.members = vec![attr_src];
        let mut text_child = text("Count is ");
        if let Member::Text { span: tspan, .. } = &mut text_child {
            *tspan = Some(span(30, 42));
        }
        button.members = vec![text_child];
        root.members = vec![Member::Element(img), Member::Element(button)];

        let (code, spans) = generate_document_with_spans(&Document { root });
        assert_eq!(code, r#"__dml_e("div", null, [ __dml_e("img", { "src": hero }), __dml_e("button", null, "Count is ") ])"#);
        // roles in order: div-tag, img-tag, src-name, hero-value, button-tag, text
        let roles: Vec<SpanRole> = spans.iter().map(|s| s.role).collect();
        assert_eq!(
            roles,
            vec![
                SpanRole::Tag,
                SpanRole::Tag,
                SpanRole::AttrName,
                SpanRole::AttrValue,
                SpanRole::Tag,
                SpanRole::Text,
            ]
        );
        // every raw span maps to a lowered span within the code
        for s in &spans {
            assert!(s.lowered.0 <= s.lowered.1 && s.lowered.1 <= code.len());
        }
        // the lowered tag for img sits inside __dml_e("img"...
        let img_span = spans[1];
        assert_eq!(&code[img_span.lowered.0..img_span.lowered.1], "img");
        let hero_span = spans[3];
        assert_eq!(&code[hero_span.lowered.0..hero_span.lowered.1], "hero");
    }

    #[test]
    fn component_lowers_to_a_props_call() {
        let mut root = el(
            "Counter",
            vec![
                attr("step", DmlValue::Number(2.0)),
                attr("label", DmlValue::Bare("props.label".into())),
            ],
        );
        root.span = Some(span(0, 7));
        let mut members = root.members;
        if let Member::Attribute {
            name_span,
            value_span,
            ..
        } = &mut members[0]
        {
            *name_span = Some(span(9, 13));
            *value_span = Some(span(15, 16));
        }
        if let Member::Attribute {
            name_span,
            value_span,
            ..
        } = &mut members[1]
        {
            *name_span = Some(span(18, 23));
            *value_span = Some(span(25, 36));
        }
        root.members = members;

        let (code, spans) = generate_document_with_spans(&Document { root });
        assert_eq!(code, r#"Counter({ "step": 2, "label": props.label })"#);
        let roles: Vec<SpanRole> = spans.iter().map(|s| s.role).collect();
        assert_eq!(
            roles,
            vec![
                SpanRole::ComponentTag,
                SpanRole::ComponentAttrName,
                SpanRole::ComponentAttrValue,
                SpanRole::ComponentAttrName,
                SpanRole::ComponentAttrValue,
            ]
        );
        // the tag maps to the identifier itself (TS owns navigation on it)
        assert_eq!(&code[spans[0].lowered.0..spans[0].lowered.1], "Counter");
        assert_eq!(&code[spans[2].lowered.0..spans[2].lowered.1], "2");
        assert_eq!(&code[spans[4].lowered.0..spans[4].lowered.1], "props.label");
    }

    #[test]
    fn component_without_props_is_an_empty_call() {
        let doc = Document {
            root: el("Badge", vec![]),
        };
        assert_eq!(generate_document(&doc), "Badge({})");
    }

    #[test]
    fn component_forwards_children_as_a_key() {
        let doc = Document {
            root: el(
                "Card",
                vec![
                    attr("title", DmlValue::String("t".into())),
                    Member::Element(el("span", vec![text("x")])),
                ],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"Card({ "title": "t", children: [ __dml_e("span", null, "x") ] })"#
        );
    }

    #[test]
    fn nested_component_is_called_recursively() {
        let doc = Document {
            root: el("div", vec![Member::Element(el("Badge", vec![]))]),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(code, r#"__dml_e("div", null, Badge({}))"#);
    }

    /// `@template("name") { body }` as an AST node.
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
    fn template_call_becomes_a_named_prop() {
        let doc = Document {
            root: el(
                "Panel",
                vec![
                    attr("title", DmlValue::String("demo".into())),
                    template_call("footer", vec![Member::Element(el("span", vec![text("x")]))]),
                ],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"Panel({ "title": "demo", "footer": [ __dml_e("span", null, "x") ] })"#
        );
    }

    #[test]
    fn template_call_keeps_positional_children() {
        let doc = Document {
            root: el(
                "Panel",
                vec![
                    template_call("footer", vec![Member::Element(el("span", vec![text("f")]))]),
                    Member::Element(el("Badge", vec![attr("label", DmlValue::String("x".into()))])),
                ],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"Panel({ "footer": [ __dml_e("span", null, "f") ], children: [ Badge({ "label": "x" }) ] })"#
        );
    }

    #[test]
    fn slot_outlet_falls_back_when_no_content_is_passed() {
        let doc = Document {
            root: el(
                "section",
                vec![slot_outlet(
                    "footer",
                    vec![Member::Element(el("footer", vec![text("none")]))],
                )],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"__dml_e("section", null, (props.footer ?? [__dml_e("footer", null, "none")]))"#
        );
    }

    #[test]
    fn slot_outlet_joins_several_fallback_nodes() {
        let doc = Document {
            root: el(
                "section",
                vec![slot_outlet(
                    "footer",
                    vec![
                        Member::Element(el("footer", vec![text("a")])),
                        Member::Element(el("footer", vec![text("b")])),
                    ],
                )],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"__dml_e("section", null, (props.footer ?? [__dml_e("footer", null, "a"), __dml_e("footer", null, "b")]))"#
        );
    }

    /// `@if (cond) { body }` as an AST node.
    fn if_block(cond: &str, cond_span: Option<dml_ast::Span>, body: Vec<Member>) -> Member {
        Member::Directive(Directive {
            kind: DirectiveKind::If {
                cond: DmlValue::Expr(cond.to_string()),
                cond_span,
                otherwise: None,
            },
            body,
            span: None,
        })
    }

    #[test]
    fn if_block_lowers_to_a_ts_conditional() {
        let doc = Document {
            root: el(
                "div",
                vec![if_block(
                    "count > 0",
                    Some(span(20, 29)),
                    vec![Member::Element(el("span", vec![text("hi")]))],
                )],
            ),
        };
        let (code, spans) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"__dml_e("div", null, (count > 0 ? [ __dml_e("span", null, "hi") ] : null))"#
        );
        // the condition is a mapped expression (TS owns it)
        assert_eq!(spans.len(), 1, "{spans:?}");
        assert_eq!(spans[0].role, SpanRole::Expr);
        assert_eq!(&code[spans[0].lowered.0..spans[0].lowered.1], "count > 0");
    }

    #[test]
    fn for_block_lowers_to_a_map_with_the_loop_variable() {
        let mut child = expr("it.label");
        if let Member::Expr { span: child_span, .. } = &mut child {
            *child_span = Some(span(40, 48));
        }
        let doc = Document {
            root: el(
                "ul",
                vec![Member::Directive(Directive {
                    kind: DirectiveKind::For {
                        var: "it".to_string(),
                        var_span: Some(span(20, 22)),
                        iter: DmlValue::Expr("items".into()),
                        iter_span: Some(span(10, 15)),
                    },
                    body: vec![
                        Member::Attribute {
                            name: "key".to_string(),
                            value: DmlValue::Expr("it.id".into()),
                            name_span: Some(span(30, 33)),
                            value_span: Some(span(35, 40)),
                        },
                        child,
                    ],
                    span: None,
                })],
            ),
        };
        let (code, spans) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"__dml_e("ul", null, Array.from(items).map((it) => (it.id, [ () => it.label ])))"#
        );
        // iterable, loop binding, key and the body expression are all TS-owned
        let roles: Vec<SpanRole> = spans.iter().map(|s| s.role).collect();
        assert_eq!(
            roles,
            vec![
                SpanRole::Expr,
                SpanRole::LoopVar,
                SpanRole::Expr,
                SpanRole::Expr
            ]
        );
        assert_eq!(&code[spans[0].lowered.0..spans[0].lowered.1], "items");
        assert_eq!(&code[spans[1].lowered.0..spans[1].lowered.1], "it");
        assert_eq!(&code[spans[2].lowered.0..spans[2].lowered.1], "it.id");
        assert_eq!(&code[spans[3].lowered.0..spans[3].lowered.1], "it.label");
    }

    #[test]
    fn directive_words_are_never_props() {
        // `@if` / `@for` / `@key` are placement metadata, never props
        let doc = Document {
            root: el(
                "div",
                vec![Member::Element(el(
                    "span",
                    vec![
                        attr("key", DmlValue::String("k".into())),
                        attr("class", DmlValue::String("x".into())),
                    ],
                ))],
            ),
        };
        let (code, _) = generate_document_with_spans(&doc);
        assert_eq!(
            code,
            r#"__dml_e("div", null, __dml_e("span", { "class": "x" }))"#
        );
    }

    fn span(s: usize, e: usize) -> dml_ast::Span {
        dml_ast::Span {
            start: s,
            end: e,
            line: 0,
            col: 0,
        }
    }
}
