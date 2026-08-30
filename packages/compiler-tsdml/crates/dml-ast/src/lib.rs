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
    },
    /// `childName { ... }`
    Element(Element),
    /// `"text"` or `#text: "..."`
    Text(String),
    /// a TSDML template expression child, e.g. `` `count()` `` (emitted verbatim)
    Expr(String),
    /// an ordered content sequence `[ ... ]`
    Sequence(Vec<Member>),
    /// `@ns: { ... }` — a namespace scope that prefixes its inner bare keys
    NamespaceScope {
        prefix: String,
        inner: Vec<Member>,
    },
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub line: u32,
    pub col: u32,
}

impl NodeKind {
    pub const fn of(m: &Member) -> NodeKind {
        match m {
            Member::Attribute { .. } => NodeKind::Attribute,
            Member::Element(_) => NodeKind::Element,
            Member::Text(_) => NodeKind::Text,
            Member::Expr(_) => NodeKind::Text,
            Member::Sequence(_) => NodeKind::Sequence,
            Member::NamespaceScope { .. } => NodeKind::NamespaceScope,
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
