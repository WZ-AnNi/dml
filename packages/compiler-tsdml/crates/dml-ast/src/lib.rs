//! DML-AST: the typed syntax tree of the DML language.
//!
//! This crate owns the AST *types only* — it has no lexer, no parser, no code
//! generator. Keeping the AST in its own crate is the "atomization" that lets
//! the parser (produce DML-AST) and the future codegen (consume DML-AST) stay
//! independent and testable.

use std::fmt;

/// A parsed DML value: essentially a JSON-like value plus bare identifiers.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DmlValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Null,
    Bare(String),
    /// A TSDML template expression (backtick-quoted), e.g. `` `count()` ``.
    /// Emitted verbatim by codegen; not a runtime literal.
    Expr(String),
    Array(Vec<DmlValue>),
    Object(Vec<(String, DmlValue)>),
}

/// A marker for the kind of a node, used by editors / codegen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Element,
    Attribute,
    Text,
    Sequence,
    NamespaceScope,
}

/// One member inside an element's block.
#[derive(Debug, Clone, PartialEq)]
pub enum Member {
    /// `@name: value`  or, inside a namespace scope, `name: value`
    Attribute {
        /// full attribute name, may include a namespace prefix (e.g. `android:layout_width`)
        name: String,
        value: DmlValue,
        /// byte span of the attribute NAME in the raw source (`src`, not `@src`)
        name_span: Option<Span>,
        /// byte span of the attribute VALUE in the raw source
        value_span: Option<Span>,
    },
    /// `childName { ... }`
    Element(Element),
    /// `"text"` or `#text: "..."`
    Text {
        text: String,
        /// byte span of the string content in the raw source
        span: Option<Span>,
    },
    /// a TSDML template expression child, e.g. `` `count()` `` (emitted verbatim)
    Expr {
        expr: String,
        /// byte span of the expression in the raw source (excludes delimiters)
        span: Option<Span>,
    },
    /// an ordered content sequence `[ ... ]`
    Sequence(Vec<Member>),
    /// `@ns: { ... }` — a namespace scope that prefixes its inner bare keys
    NamespaceScope {
        prefix: String,
        inner: Vec<Member>,
    },
    /// `@if (cond) { … } @else { … }` / `@for (x of items).key(x.id) { … }`
    ///
    /// The compact element form is the same node: `li { @if: cond }` parses to a
    /// `Directive` whose body is that one element, so codegen has a single path.
    Directive(Directive),
    /// `@name(...) { body }` — a macro component call.
    ///
    /// The `()` head is preserved as raw source (not parsed here); the registered
    /// macro component's `parse` function interprets it at codegen time. The body
    /// is a normal member list (same grammar as an element's body).
    ///
    /// Built-in `@if`/`@for` still produce `Directive` (compat path in parser);
    /// user-defined macro components produce `MacroCall`.
    MacroCall(MacroCall),
}

/// A control-flow block.
#[derive(Debug, Clone, PartialEq)]
pub struct Directive {
    pub kind: DirectiveKind,
    /// The members the block renders (an element body's grammar).
    pub body: Vec<Member>,
    /// byte span of the whole directive in the raw source
    pub span: Option<Span>,
}

/// A macro component call: `@name(...) { body }`.
///
/// The `()` head is preserved as raw source; the registered macro component's
/// `parse` function interprets it at codegen time. The body is a normal member
/// list (same grammar as an element's body).
#[derive(Debug, Clone, PartialEq)]
pub struct MacroCall {
    /// The macro component name (without `@` prefix).
    pub name: String,
    /// byte span of the name in the raw source
    pub name_span: Option<Span>,
    /// The raw source inside `()` (not parsed here).
    pub head_src: String,
    /// byte span of the head in the raw source (includes `(` and `)`)
    pub head_span: Option<Span>,
    /// The body members (normal member list, same grammar as element body).
    pub body: Vec<Member>,
    /// byte span of the whole macro call in the raw source
    pub span: Option<Span>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DirectiveKind {
    /// `@if (cond) { … }` with optional `@else if` / `@else` arms. The arms are
    /// a chain: `otherwise` is the next `Directive::If` (or its `body` holds the
    /// plain `@else` members).
    If {
        cond: DmlValue,
        cond_span: Option<Span>,
        otherwise: Option<ElseArm>,
    },
    /// `@for (var of iterable) { … }`
    For {
        /// the binding, verbatim (`tick`, `[k, v]`, …) — it becomes the arrow
        /// parameter of the generated `.map(...)`
        var: String,
        var_span: Option<Span>,
        iter: DmlValue,
        iter_span: Option<Span>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum ElseArm {
    /// `@else if (cond) { … }` (boxed: the arm chain is recursive)
    If(Box<Directive>),
    /// `@else { … }`
    Block { body: Vec<Member>, span: Option<Span> },
}

/// A DML element.
#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub name: String,
    /// ordered attributes and children (order is significant for documents)
    pub members: Vec<Member>,
    /// source location (line, column) for diagnostics
    pub span: Option<Span>,
}

/// A document is a DML element (possibly the implicit root).
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub root: Element,
}

/// Source span for error reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub line: u32,
    pub col: u32,
}

/// The role of a node in the raw↔lowered mapping (editor-facing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpanRole {
    /// A host element tag (`div`): the template AST layer owns it.
    Tag,
    /// An attribute name on a host element (`class`).
    AttrName,
    /// An attribute value on a host element.
    AttrValue,
    /// Literal text.
    Text,
    /// An embedded TypeScript expression.
    Expr,
    /// A **component** tag (`Counter`): a TypeScript identifier, so the TS
    /// service owns hover / go-to-definition / completion for it.
    ComponentTag,
    /// A prop name on a component: completion comes from the component's
    /// declared props type, so TS owns it.
    ComponentAttrName,
    /// A prop value on a component.
    ComponentAttrValue,
    /// The binding of `@for (tick of …)`: a TypeScript *binding* the generated
    /// `.map((tick) => …)` declares, so the TS service owns it (rename, type).
    LoopVar,
    /// The slot name inside `@template("name")` / `@slot("name")`. The editor
    /// answers it (completion from the component's declared slots), so the
    /// template layer owns it rather than the TS string-literal oracle.
    SlotName,
}

/// One authoritative mapping: a raw fragment ↔ its lowered counterpart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct NodeSpan {
    pub role: SpanRole,
    /// byte span in the raw template (inner DML text)
    pub raw: (usize, usize),
    /// byte span in the lowered `e(...)` output
    pub lowered: (usize, usize),
}

impl Element {
    /// The byte span of this element's NAME in the raw source.
    pub fn name_span(&self) -> Option<Span> {
        self.span
    }
}

impl NodeKind {
    pub const fn of(m: &Member) -> NodeKind {
        match m {
            Member::Attribute { .. } => NodeKind::Attribute,
            Member::Element(_) => NodeKind::Element,
            Member::Text { .. } => NodeKind::Text,
            Member::Expr { .. } => NodeKind::Text,
            Member::Sequence(_) => NodeKind::Sequence,
            Member::NamespaceScope { .. } => NodeKind::NamespaceScope,
            Member::Directive(_) => NodeKind::Sequence,
            Member::MacroCall(_) => NodeKind::Sequence,
        }
    }
}

impl fmt::Display for DmlValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::String(s) => write!(f, "{s:?}"),
            Self::Number(n) => write!(f, "{n}"),
            Self::Boolean(b) => write!(f, "{b}"),
            Self::Null => write!(f, "null"),
            Self::Bare(b) => write!(f, "{b}"),
            Self::Expr(e) => write!(f, "`{e}`"),
            Self::Array(items) => {
                write!(f, "[")?;
                for (i, it) in items.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{it}")?;
                }
                write!(f, "]")
            }
            Self::Object(pairs) => {
                write!(f, "{{")?;
                for (i, (k, v)) in pairs.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{k}: {v}")?;
                }
                write!(f, "}}")
            }
        }
    }
}
