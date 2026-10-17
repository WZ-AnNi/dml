/**
 * @tsdml/transform — shared TSDML source transform.
 *
 * A `.tsdml` file is a TypeScript module with DML template blocks marked by
 * `@{ ... }` (the TSDML analogue of a JSX Fragment). This package finds those
 * blocks (skipping comments and string literals) and lowers each one into
 * `e(tag, props, children)` runtime calls using the native Rust compiler.
 *
 * Both the Vite plugin and the TypeScript language-service plugin use this so
 * the editor and the build agree on exactly what a `.tsdml` file means.
 */

import { compileModule, compileWithSpans } from "@tsdml/compiler"

export const TSDML_EXT = ".tsdml"

/**
 * Runtime helper → the name compiled code binds it to. The optimizing backend
 * emits `_$template(...)` / `_$insert(...)` / ... and the module transform
 * imports exactly the helpers the module uses.
 */
const HELPER_ALIASES: Record<string, string> = {
  template: "_$template",
  insert: "_$insert",
  setProp: "_$setProp",
  setPropReactive: "_$setPropReactive",
  on: "_$on",
  each: "_$each",
}

/** Reserved binding the *editor* lowering uses for the typed IR. */
export const EDITOR_RUNTIME_FN = "__dml_e"

/**
 * Prologue prepended to the editor snapshot. The typed IR (`__dml_e(tag,
 * props, children)`) needs a binding in scope; injecting it here keeps user
 * source free of any renderer argument — a component is just
 * `function Counter(props)`.
 */
function editorPrologue(runtimeModule: string): string {
  return (
    `import type { E as __DmlE } from ${JSON.stringify(runtimeModule)}\n` +
    `declare const ${EDITOR_RUNTIME_FN}: __DmlE\n`
  )
}

export interface ModuleTransformOptions {
  /** Module the compiled output imports its runtime helpers from. */
  runtimeModule?: string
}

/**
 * **Build transform.** Lower every `@{ ... }` block in a module into the
 * optimizing runtime IR and hoist the static template shapes to module scope.
 *
 * No `e(...)` calls, no per-render props objects and no per-render children
 * arrays: the static structure is one hoisted `_$template(shape)` constant that
 * the host clones per instance, and dynamic bindings address nodes by their
 * index in the flat walk. See `@tsdml/compiler`'s `compile_module`.
 */
export function transformModule(
  src: string,
  options: ModuleTransformOptions = {},
): string {
  const runtimeModule = options.runtimeModule ?? "@dml/runtime-dom"
  let out = src
  let cursor = 0
  let blockIndex = 0
  const preludes: string[] = []
  const helpers = new Set<string>()
  for (;;) {
    const block = findTemplateBlock(out, cursor)
    if (!block) break
    const [start, end] = block
    const innerText = out.slice(start + 2, end - 1)
    const result = compileModule(innerText, blockIndex++)
    for (const h of result.helpers) helpers.add(h)
    if (result.prelude) preludes.push(result.prelude)
    out = out.slice(0, start) + result.expr + out.slice(end)
    cursor = start + result.expr.length
  }
  if (helpers.size === 0) return src
  const imports = [...helpers]
    .sort()
    .map((h) => `${h} as ${HELPER_ALIASES[h] ?? "_$" + h}`)
    .join(", ")
  const header =
    `import { ${imports} } from ${JSON.stringify(runtimeModule)}\n` +
    preludes.join("\n") +
    "\n"
  return header + out
}

/**
 * Find the next `@{` block (outside comments/strings) and return
 * `[start, end, innerDml]` where `start`/`end` are indices into `src` and
 * `innerDml` is the TRIMMED DML text between the braces (historical contract;
 * the editor transform re-slices the untrimmed inner itself so node spans
 * stay aligned).
 */
export function findTemplateBlock(
  src: string,
  from: number,
): [number, number, string] | null {
  let i = from
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (quote) {
      if (c === "\\") {
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      i++
      continue
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && next === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (c === "@" && next === "{") {
      // found a template block — scan for its matching '}'
      const open = i
      let depth = 1
      i += 2
      while (i < src.length) {
        const d = src[i]
        const dn = src[i + 1]
        if (d === '"' || d === "'" || d === "`") {
          const q = d
          i++
          while (i < src.length) {
            if (src[i] === "\\") {
              i += 2
              continue
            }
            if (src[i] === q) break
            i++
          }
          i++
          continue
        }
        if (d === "/" && dn === "/") {
          while (i < src.length && src[i] !== "\n") i++
          continue
        }
        if (d === "/" && dn === "*") {
          i += 2
          while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
          i += 2
          continue
        }
        if (d === "{") {
          depth++
          i++
          continue
        }
        if (d === "}") {
          depth--
          if (depth === 0) {
            const inner = src.slice(open + 2, i).trim()
            return [open, i + 1, inner]
          }
          i++
          continue
        }
        i++
      }
      return null
    }
    i++
  }
  return null
}

/** Result of {@link transformSourceDetailed}. */
export interface TransformDetailed {
  /** The transformed source. */
  code: string
  /**
   * `[start, end)` spans — in *transformed* coordinates — of every lowered
   * template call. Diagnostics that land inside one of these spans come from
   * template-generated code, not from the user's TypeScript.
   */
  templateSpans: Array<[number, number]>
  /**
   * One entry per `@{ ... }` block (same walk order as `templateSpans`).
   * Each entry is the authoritative raw↔lowered node map the Rust compiler
   * produced for that block: `raw` is byte span in the FILE (already offset
   * by the block's inner start), `lowered` is byte span in `code` (already
   * offset by the block's lowered position in the final output).
   */
  blockNodes: Array<Array<EditorNodeSpan>>
  /**
   * Length of the generated prologue. Generated (= `code`) offsets are all
   * shifted by this much relative to the user source, so identity mappings for
   * the untouched TypeScript must start here.
   */
  baseOffset: number
}

/**
 * A raw↔lowered fragment pair, in file coordinates, produced by
 * `@tsdml/compiler`'s `compileWithSpans`.
 */
export interface SourceDiagnostic {
  /** Byte offset into the `.tsdml` FILE (not the block). */
  start: number
  /** Byte offset (exclusive); always > start. */
  end: number
  message: string
}

/**
 * Parser diagnostics for a `.tsdml` module, in **file byte coordinates**.
 *
 * The Rust compiler is tolerant (a malformed value still yields a usable AST),
 * so errors are reported here rather than thrown — the editor turns them into
 * diagnostics (see the VS Code extension's `tsdmlDiagnostics`).
 */
export function collectDiagnostics(src: string): SourceDiagnostic[] {
  const out: SourceDiagnostic[] = []
  let cursor = 0
  for (;;) {
    const block = findTemplateBlock(src, cursor)
    if (!block) break
    const [start, end] = block
    const innerText = src.slice(start + 2, end - 1)
    const result = compileWithSpans(innerText)
    const base = start + 2
    for (const err of result.errors ?? []) {
      const errStart = base + err.span.start
      out.push({
        start: errStart,
        end: Math.max(errStart + 1, base + err.span.end),
        message: err.message,
      })
    }
    cursor = end
  }
  return out
}

export interface EditorNodeSpan {
  /**
   * - `tag` / `attrName` / `text`: structural template tokens — the template
   *   AST layer owns them (TS must stay out).
   * - `attrValue` / `expr`: TypeScript expressions — TS is the type oracle.
   * - `componentTag` / `componentAttrName` / `componentAttrValue`: component
   *   identifier and its props — a TS identifier / the component's declared
   *   props type, so TS owns hover, navigation and completion for them.
   * - `loopVar`: the binding of `@for (tick of …)` — the arrow parameter TS
   *   declares, so TS owns its type, hover and rename.
   */
  role:
    | 'tag'
    | 'attrName'
    | 'attrValue'
    | 'text'
    | 'expr'
    | 'componentTag'
    | 'componentAttrName'
    | 'componentAttrValue'
    | 'loopVar'
  raw: [number, number]
  lowered: [number, number]
}

type RawRole = EditorNodeSpan['role']

/** Map the napi role strings to our canonical editor roles. */
const ROLE_MAP: Record<string, RawRole> = {
  tag: 'tag',
  attrName: 'attrName',
  attrValue: 'attrValue',
  text: 'text',
  expr: 'expr',
  componentTag: 'componentTag',
  componentAttrName: 'componentAttrName',
  componentAttrValue: 'componentAttrValue',
  loopVar: 'loopVar',
}

interface NapiSpan {
  role: string
  raw: [number, number]
  lowered: [number, number]
}
interface NapiResult {
  code: string
  spans: NapiSpan[]
  errors?: unknown[]
}

export interface DetailedTransformOptions {
  /** Module the editor prologue imports the template type from. */
  runtimeModule?: string
}

/**
 * Lower every `@{ ... }` block in a source string into `e(...)` calls, leaving
 * the surrounding TypeScript untouched. Also reports where each lowered call
 * sits in the *output* text, so callers (e.g. the language-service plugin) can
 * tell template-generated diagnostics apart from real TypeScript errors.
 *
 * This is the **editor transform**: it emits the *typed IR* the TypeScript
 * server can type-check (a reserved `__dml_e(tag, props, children)` call per
 * element), which is why a snapshot is prefixed with a prologue declaring that
 * binding. The build uses {@link transformModule} instead.
 */
export function transformSourceDetailed(
  src: string,
  options: DetailedTransformOptions = {},
): TransformDetailed {
  const prologue = editorPrologue(options.runtimeModule ?? "@dml/runtime-dom")
  let out = src
  let cursor = 0
  const templateSpans: Array<[number, number]> = []
  const blockNodes: Array<Array<EditorNodeSpan>> = []
  for (;;) {
    const block = findTemplateBlock(out, cursor)
    if (!block) break
    const [start, end] = block
    // Feed the parser the UNTRIMMED inner text (its node spans are byte
    // offsets into this exact slice); `@{`/`}` are at start/end-1.
    const innerText = out.slice(start + 2, end - 1)
    // compileWithSpans never throws: malformed templates recover and report
    // errors in the returned object. Lowered code is still produced for every
    // fragment that parsed, so the editor keeps working mid-typing.
    const result = compileWithSpans(innerText)
    // Editor IR only: a fragment the parser rejected (and that oxc therefore
    // did not validate as TypeScript) must not reach the language service as
    // raw text — TS would answer with a syntax-error cascade on top of the one
    // real diagnostic. Blank it to a same-length `0`, so the file still
    // type-checks and every offset (and mapping) stays valid.
    const lowered = blankInvalidFragments(result)
    // templateSpans covers ONLY the generated call (no padding): diagnostics
    // inside the call are template noise; the padded whitespace after it is
    // real code space and stays visible.
    templateSpans.push([start, start + lowered.length])
    // Translate the authoritative spans into FILE coordinates: raw spans are
    // relative to `innerText` (which starts at `start + 2`); lowered spans are
    // relative to this block's code (which starts at `start` in the final
    // output — later replacements only append after it, so this offset is
    // final).
    const innerBase = start + 2
    blockNodes.push(
      result.spans.map((s) => ({
        role: ROLE_MAP[s.role] ?? 'text',
        raw: [innerBase + s.raw[0], innerBase + s.raw[1]] as [number, number],
        lowered: [start + s.lowered[0], start + s.lowered[1]] as [number, number],
      })),
    )
    const pad = Math.max(0, end - start - lowered.length)
    out = out.slice(0, start) + lowered + ' '.repeat(pad) + out.slice(end)
    cursor = start + lowered.length
  }
  // The prologue shifts every generated offset; raw offsets stay in user
  // source coordinates.
  const base = prologue.length
  return {
    code: prologue + out,
    baseOffset: base,
    templateSpans: templateSpans.map(([s, e]) => [s + base, e + base] as [number, number]),
    blockNodes: blockNodes.map((nodes) =>
      nodes.map((n) => ({
        ...n,
        lowered: [n.lowered[0] + base, n.lowered[1] + base] as [number, number],
      })),
    ),
  }
}

/**
 * Replace the lowered text of every fragment the parser rejected with a
 * same-length `0`.
 *
 * A rejected value keeps its raw text in the AST (the build must fail loudly),
 * but that text is only *sometimes* valid TypeScript — feeding it to the
 * language service produces a cascade of TS syntax errors (TS1005/TS1136/
 * TS18004) that buries the single diagnostic we already report. Writing a valid
 * expression of the exact same length keeps every offset and mapping intact.
 */
function blankInvalidFragments(result: CompileWithSpansResult): string {
  const errors = result.errors ?? []
  if (errors.length === 0) return result.code
  let code = result.code
  const holes: Array<[number, number]> = []
  for (const err of errors) {
    // the NARROWEST node span that covers the error is the fragment to blank
    let best: [number, number] | null = null
    for (const span of result.spans) {
      const [rawStart, rawEnd] = span.raw
      if (err.span.start < rawStart || err.span.start >= Math.max(rawEnd, rawStart + 1)) continue
      if (best === null || rawEnd - rawStart < best[1] - best[0]) {
        best = [span.lowered[0], span.lowered[1]]
      }
    }
    if (best && best[1] > best[0]) holes.push(best)
  }
  // right-to-left so earlier offsets stay valid while splicing
  for (const [start, end] of holes.sort((a, b) => b[0] - a[0])) {
    const replacement = '0'.padEnd(end - start, ' ')
    code = code.slice(0, start) + replacement + code.slice(end)
  }
  return code
}

/** Lower every `@{ ... }` block in a source string into `e(...)` calls. */
export function transformSource(
  src: string,
  options: DetailedTransformOptions = {},
): string {
  return transformSourceDetailed(src, options).code
}
