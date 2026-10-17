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
import { platform, arch } from "node:process"
import { transformMacros } from "./transform.js"

// Re-export macro registry API
export { registerMacro, getMacro, hasMacro } from "./registry.js"
export type { MacroComponent, MacroContext, IrExpr, Token, TokenStream } from "./macro-types.js"

export interface DmlSpan {
  start: number
  end: number
  line: number
  col: number
}

/** A compact byte span used for editor routing (line/col omitted). */
export interface DmlByteSpan {
  start: number
  end: number
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
  | {
      kind: "element"
      name: string
      /** byte span of the element TAG in the raw source (null on recovery) */
      span: DmlByteSpan | null
      members: DmlMemberJson[]
    }
  | {
      kind: "attribute"
      name: string
      value: DmlValueJson
      /** byte span of the attribute NAME (`@` excluded) in the raw source */
      nameSpan: DmlByteSpan | null
      /** byte span of the attribute VALUE in the raw source */
      valueSpan: DmlByteSpan | null
    }
  | {
      kind: "text"
      value: string
      /** byte span of the string CONTENT in the raw source */
      span: DmlByteSpan | null
    }
  | {
      kind: "expr"
      value: string
      /** byte span of the expression text in the raw source */
      span: DmlByteSpan | null
    }
  | { kind: "sequence"; items: DmlMemberJson[] }
  | { kind: "namespaceScope"; prefix: string; inner: DmlMemberJson[] }
  | {
      kind: "macroCall"
      name: string
      /** byte span of the macro name in the raw source */
      nameSpan: DmlByteSpan | null
      /** raw source text inside the (...) head */
      headSrc: string
      /** byte span of the (...) head in the raw source */
      headSpan: DmlByteSpan | null
      /** byte span of the whole macro call in the raw source */
      span: DmlByteSpan | null
      items: DmlMemberJson[]
    }

export type DmlElementJson = Extract<DmlMemberJson, { kind: "element" }>

export type NodeRole = "tag" | "attrName" | "attrValue" | "text" | "expr"

/** A raw↔lowered fragment pair (byte offsets), relative to the input string
 *  and to the emitted code respectively. Produced by the Rust codegen. */
export interface CompileSpan {
  role: NodeRole
  raw: [number, number]
  lowered: [number, number]
}

export interface CompileError {
  message: string
  span: { start: number; end: number; line: number; col: number }
}

export interface CompileWithSpansResult {
  code: string
  spans: CompileSpan[]
  errors: CompileError[]
}

/** Runtime helpers the optimizing backend can emit calls to. */
export type ModuleHelper =
  | "template"
  | "insert"
  | "setProp"
  | "setPropReactive"
  | "on"
  | "each"

/** The optimizing build output for one template block. */
export interface CompileModuleResult {
  /** Hoisted static template shape (JS array literal). */
  shape: string
  /** Module-scope declarations: the template constants. */
  prelude: string
  /** Expression that replaces the `@{ ... }` block. */
  expr: string
  /** Runtime helpers the emitted code calls. */
  helpers: ModuleHelper[]
}

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
  const code = binding.compile(source)
  const { code: transformed, errors } = transformMacros(code)
  if (errors.length > 0) {
    // ponytail: errors are logged but don't throw — tolerant by contract
    console.warn("[@tsdml/compiler] macro transform errors:", errors)
  }
  return transformed
}

/**
 * Compile DML source text and return `{ code, spans, errors }` — the
 * authoritative raw↔lowered map the editor needs for exact hover/completion/
 * navigation in templates, plus any tolerant-parse errors. Never throws on
 * malformed DML (the parser recovers).
 */
export function compileWithSpans(source: string): CompileWithSpansResult {
  const binding = loadBinding()
  return JSON.parse(binding.compileWithSpans(source)) as CompileWithSpansResult
}

/**
 * Lower ONE template block (the text between `@{` and `}`) into the optimizing
 * build output: a hoisted static template shape plus index-addressed dynamic
 * bindings. `suffix` disambiguates the hoisted template constants across the
 * blocks of one module.
 */
export function compileModule(source: string, suffix = 0): CompileModuleResult {
  const binding = loadBinding()
  return JSON.parse(binding.compileModule(source, suffix)) as CompileModuleResult
}

interface NativeBinding {
  parse(source: string): string
  compile(source: string): string
  compileWithSpans(source: string): string
  compileModule(source: string, suffix: number): string
}

let cached: NativeBinding | null = null

function loadBinding(): NativeBinding {
  if (cached) return cached

  const req = createRequire(import.meta.url)

  // `scripts/copy-node.mjs` ships the SAME release binary under two names: the
  // platform triple (`tsdml-compiler.win32-x64-msvc.node`, the napi convention)
  // and the generic `index.node`.
  //
  // The generic name is tried FIRST on purpose: it is the one the copy script
  // can always refresh. On Windows a running dev server maps the triple file
  // for the life of the process, so a copy onto it fails with EIO and the
  // package would silently keep executing the previous compiler — which is
  // exactly the "my fix is not taking effect" trap. Both files come from the
  // same release artifact, so preferring the updatable one costs nothing.
  const abi = platform === "win32" ? "msvc" : platform === "darwin" ? "darwin" : "gnu"
  const triple = `${platform}-${arch}-${abi}`
  const candidates = [
    "./index.node",
    "../index.node",
    `./${"tsdml-compiler"}.${triple}.node`,
    `../${"tsdml-compiler"}.${triple}.node`,
  ]
  for (const spec of candidates) {
    try {
      const m = req(spec) as Record<string, unknown>
      cached = m as unknown as NativeBinding
      return cached
    } catch {
      // try next
    }
  }
  // Last resort: the napi-generated platform loader
  cached = req("@tsdml/compiler/binding.js") as unknown as NativeBinding
  return cached
}
