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

import { createRequire } from "node:module"

export interface DmlSpan {
  start: number
  end: number
  line: number
  col: number
}

export type DmlValueJson =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "bare"; value: string }
  | { type: "expr"; value: string }
  | { type: "array"; items: DmlValueJson[] }
  | { type: "object"; value: Record<string, DmlValueJson> }

export type DmlMemberJson =
  | { kind: "element"; name: string; members: DmlMemberJson[] }
  | { kind: "attribute"; name: string; value: DmlValueJson }
  | { kind: "text"; value: string }
  | { kind: "expr"; value: string }
  | { kind: "sequence"; items: DmlMemberJson[] }
  | { kind: "namespaceScope"; prefix: string; inner: DmlMemberJson[] }

export type DmlElementJson = Extract<DmlMemberJson, { kind: "element" }>

/**
 * Parse DML source text and return the DML-AST as a plain object.
 * The result is the root element (kind: "element"). Implemented in Rust as a
 * napi binding; throws if the binding isn't built or the source is invalid.
 */
export function parse(source: string): DmlElementJson {
  const binding = loadBinding()
  return JSON.parse(binding.parse(source)) as DmlElementJson
}

/**
 * Compile DML source text into framework runtime-call source code (the TSDML
 * lowering). Implemented in Rust as a napi binding.
 */
export function compile(source: string): string {
  const binding = loadBinding()
  return binding.compile(source)
}

interface NativeBinding {
  parse(source: string): string
  compile(source: string): string
}

let cached: NativeBinding | null = null

function loadBinding(): NativeBinding {
  if (cached) return cached

  const req = createRequire(import.meta.url)
  try {
    // `scripts/copy-node.mjs` copies the compiled .node to the package root as
    // `index.node` after `napi build`.
    const m = req("./index.node") as Record<string, unknown>
    cached = m as unknown as NativeBinding
  } catch {
    // fallback: the napi-generated platform loader
    const dev = req("@tsdml/compiler/binding.js") as Record<string, unknown>
    cached = dev as unknown as NativeBinding
  }
  return cached
}
