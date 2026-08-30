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
    type: "array";
    items: DmlValueJson[];
} | {
    type: "object";
    value: Record<string, DmlValueJson>;
};
export type DmlMemberJson = {
    kind: "element";
    name: string;
    members: DmlMemberJson[];
} | {
    kind: "attribute";
    name: string;
    value: DmlValueJson;
} | {
    kind: "text";
    value: string;
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
//# sourceMappingURL=index.d.ts.map