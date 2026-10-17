/**
 * @tsdml/compiler — TS-side surface (THIN by design).
 *
 * The compiler is written in Rust and compiled to a `.node` binary (napi-rs).
 * This module contains ZERO compiler logic — it only declares the types and
 * lazily loads the native binding, so TS consumers get a typed entry point.
 *
 * The heavy lifting (DML lex/parse → DML-AST) lives in crates/dml-parser and
 * crates/dml-ast. See the Cargo workspace inside this package.
 */
export interface DmlSpan {
    start: number;
    end: number;
    line: number;
    col: number;
}
/** A compact byte span used for editor routing (line/col omitted). */
export interface DmlByteSpan {
    start: number;
    end: number;
}
export type DmlValueJson = {
    type: "string";
    value: string;
} | {
    type: "number";
    value: number;
} | {
    type: "boolean";
    value: boolean;
} | {
    type: "null";
} | {
    type: "bare";
    value: string;
} | {
    type: "expr";
    value: string;
} | {
    type: "array";
    items: DmlValueJson[];
} | {
    type: "object";
    value: Record<string, DmlValueJson>;
};
export type DmlMemberJson = {
    kind: "element";
    name: string;
    /** byte span of the element TAG in the raw source (null on recovery) */
    span: DmlByteSpan | null;
    members: DmlMemberJson[];
} | {
    kind: "attribute";
    name: string;
    value: DmlValueJson;
    /** byte span of the attribute NAME (`@` excluded) in the raw source */
    nameSpan: DmlByteSpan | null;
    /** byte span of the attribute VALUE in the raw source */
    valueSpan: DmlByteSpan | null;
} | {
    kind: "text";
    value: string;
    /** byte span of the string CONTENT in the raw source */
    span: DmlByteSpan | null;
} | {
    kind: "expr";
    value: string;
    /** byte span of the expression text in the raw source */
    span: DmlByteSpan | null;
} | {
    kind: "sequence";
    items: DmlMemberJson[];
} | {
    kind: "namespaceScope";
    prefix: string;
    inner: DmlMemberJson[];
};
export type DmlElementJson = Extract<DmlMemberJson, {
    kind: "element";
}>;
export type NodeRole = "tag" | "attrName" | "attrValue" | "text" | "expr";
/** A raw↔lowered fragment pair (byte offsets), relative to the input string
 *  and to the emitted code respectively. Produced by the Rust codegen. */
export interface CompileSpan {
    role: NodeRole;
    raw: [number, number];
    lowered: [number, number];
}
export interface CompileError {
    message: string;
    span: {
        start: number;
        end: number;
        line: number;
        col: number;
    };
}
export interface CompileWithSpansResult {
    code: string;
    spans: CompileSpan[];
    errors: CompileError[];
}
/**
 * Parse DML source text and return the DML-AST as a plain object.
 * The result is the root element (kind: "element"). Implemented in Rust as a
 * napi binding; throws if the binding isn't built or the source is invalid.
 */
export declare function parse(source: string): DmlElementJson;
/**
 * Compile DML source text into framework runtime-call source code (the TSDML
 * lowering). Implemented in Rust as a napi binding.
 */
export declare function compile(source: string): string;
/**
 * Compile DML source text and return `{ code, spans, errors }` — the
 * authoritative raw↔lowered map the editor needs for exact hover/completion/
 * navigation in templates, plus any tolerant-parse errors. Never throws on
 * malformed DML (the parser recovers).
 */
export declare function compileWithSpans(source: string): CompileWithSpansResult;
//# sourceMappingURL=index.d.ts.map