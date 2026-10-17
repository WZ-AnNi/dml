/**
 * TSDML semantic core (L1) — answers editor questions straight from the
 * DML AST, NOT from a lowered/forwarded TS document.
 *
 * Architecture: the `.tsdml` file is parsed in two halves and never lowered
 * to TS for the editor:
 *
 *   - the surrounding TypeScript stays in the real TS program (imports,
 *     declarations, scopes) — the TS service is only ever used as a TYPE
 *     ORACLE for template expressions, never as a completion/hover source,
 *   - each `@{ ... }` block is parsed by the Rust dml-parser into a
 *     tolerant DML AST whose nodes carry raw byte spans. This module walks
 *     that AST to answer offset → node, then resolves language data
 *     (tag lists, prop tables, hover signatures, jump targets) from a small
 *     static model of tsdml-runtime.d.ts plus the document's TS context.
 *
 * The design kills the three failure modes of the old string-lowering:
 *   - kind: tag/attr completions are produced HERE with kind "field"
 *     (matching TSX); never "constant" (TS's label for string literals),
 *   - auto-trigger: positions are identifiers, not string literals, so the
 *     editor's quickSuggestions treats them as "other",
 *   - staleness: the model is rebuilt per keystroke from the live AST; no
 *     long-lived generated document to go stale or crash.
 *
 * Zero vscode imports: works identically in the Volar language server, a
 * standalone LSP server, or tests.
 */

import type { DmlElementJson, DmlMemberJson, DmlValueJson } from "@tsdml/compiler"

// ---------------------------------------------------------------------------
// d.ts model (prop tables / signatures / jump targets)
// ---------------------------------------------------------------------------
export interface DtsMember {
  name: string
  optional: boolean
  sig: string
  /** 1-based source line in the d.ts */
  line: number
}

export interface IfaceInfo {
  /** raw extends list (type exprs), base names without type args */
  extends: string[]
  members: DtsMember[]
}

export interface DtsModel {
  /** tag → props interface type expr, e.g. `div` → `HTMLAttributes<HTMLDivElement>` */
  ifaceOfTag: Map<string, string>
  ifaceBody: Map<string, IfaceInfo>
  /** walk an interface (and its extends chain) for a member declaration */
  membersOf(typeExpr: string, want: string): DtsMember | undefined
  /** all own+inherited member names of an interface (completion source) */
  allMembersOf(typeExpr: string): DtsMember[]
}

/** Parse the `IntrinsicElements` + interfaces out of tsdml-runtime.d.ts. */
export function parseDts(dtsText: string): DtsModel {
  const ifaceOfTag = new Map<string, string>()
  const ifaceBody = new Map<string, IfaceInfo>()

  // Direct tag rows inside a flat `IntrinsicElements` block (fixture/small
  // libs): `div: HTMLAttributes<HTMLDivElement>;`
  for (const m of dtsText.matchAll(
    /^(\s*)([A-Za-z][\w-]*):\s*([^\n;]*?Attributes[^\n;]*);/gm,
  )) {
    ifaceOfTag.set(m[2]!, m[3]!.trim())
  }

  const ifaceRe =
    /^(\s*)interface\s+([A-Za-z]\w*)(?:\s*<[^>]*>)?(?:\s+extends\s+([^{]+))?\s*\{/gm
  for (const m of dtsText.matchAll(ifaceRe)) {
    const name = m[2]!
    const extendsList = (m[3] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/<.*/, "").trim())
      .filter(Boolean)
    const start = m.index! + m[0].length
    let depth = 1
    let i = start
    for (; i < dtsText.length && depth > 0; i++) {
      if (dtsText[i] === "{") depth++
      else if (dtsText[i] === "}") depth--
    }
    const body = dtsText.slice(start, i - 1)
    const members: DtsMember[] = []
    for (const mm of body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))(\??):\s*([^;]+);/gm)) {
      const line = dtsText.slice(0, start + (mm.index ?? 0)).split("\n").length
      const memberName = mm[1] ?? mm[2]!
      const sig = mm[4]!.trim()
      members.push({
        name: memberName,
        optional: mm[3] === "?",
        sig,
        line,
      })
      // Tag declarations live in the `*Tags` interfaces that IntrinsicElements
      // extends (HTMLElementTags, SVGElementTags, …), e.g.
      //   `div: HTMLAttributes<HTMLDivElement>;`
      // collect those member names → IntrinsicElements tag set.
      if (name.endsWith("Tags") && /^\s*[A-Za-z_$][\w$]*\s*</.test(sig)) {
        ifaceOfTag.set(memberName, sig)
      }
    }
    ifaceBody.set(name, { extends: extendsList, members })
  }

  const membersOf: DtsModel["membersOf"] = (typeExpr, want) => {
    const ifName = typeExpr.replace(/<.*/, "").trim()
    const seen = new Set<string>()
    const walk = (n: string): DtsMember | undefined => {
      if (seen.has(n)) return undefined
      seen.add(n)
      const body = ifaceBody.get(n)
      if (!body) return undefined
      const own = body.members.find((mm) => mm.name === want)
      if (own) return own
      for (const e of body.extends) {
        const r = walk(e.trim())
        if (r) return r
      }
      return undefined
    }
    return walk(ifName)
  }

  const allMembersOf: DtsModel["allMembersOf"] = (typeExpr) => {
    const ifName = typeExpr.replace(/<.*/, "").trim()
    const seen = new Set<string>()
    const out: DtsMember[] = []
    const walk = (n: string) => {
      if (seen.has(n)) return
      seen.add(n)
      const body = ifaceBody.get(n)
      if (!body) return
      // own members first, then bases (caller may de-dup by name)
      for (const mm of body.members) out.push(mm)
      for (const e of body.extends) walk(e.trim())
    }
    walk(ifName)
    return out
  }

  return { ifaceOfTag, ifaceBody, membersOf, allMembersOf }
}

// ---------------------------------------------------------------------------
// DML AST model (per-block, spans in FILE coordinates)
// ---------------------------------------------------------------------------
export interface DmlNode {
  kind:
    | "element"
    | "attribute"
    | "text"
    | "expr"
    | "sequence"
    | "namespaceScope"
    | "macroCall"
  name?: string
  /** element tag span / attr name span / text content span / expr span (FILE coords) */
  span?: { start: number; end: number } | null
  valueSpan?: { start: number; end: number } | null
  members?: DmlNode[]
  text?: string
  value?: DmlValueJson
  prefix?: string
  inner?: DmlNode[]
  /** parent element name (filled by walk) */
  parentTag?: string
  /** macroCall only: raw source inside the `(...)` head, e.g. `"footer"` */
  headSrc?: string
  /** macroCall only: span of the `(...)` head (FILE coords) */
  headSpan?: { start: number; end: number } | null
}

/**
 * Parse every `@{ ... }` block of a `.tsdml` file into a DmlNode forest.
 * Block spans and node spans are translated to FILE coordinates. The Rust
 * parser is tolerant: mid-typing fragments still produce whatever parsed.
 * Uses @tsdml/compiler's `parse` (AST with raw spans) + @tsdml/transform's
 * block finder, so the caller needs no wiring.
 */
export function parseFile(
  source: string,
  parse: (dml: string) => DmlElementJson,
  findBlock: (src: string, from: number) => [number, number] | null,
): { blocks: Array<{ span: [number, number]; root: DmlNode | null }>; errors: Array<{ message: string; span: unknown }> } {
  const blocks: Array<{ span: [number, number]; root: DmlNode | null }> = []
  const errors: Array<{ message: string; span: unknown }> = []
  let cursor = 0
  for (;;) {
    const block = findBlock(source, cursor)
    if (!block) break
    const [start, end] = block
    const inner = source.slice(start + 2, end - 1) // between `@{` and `}`
    const base = start + 2
    let ast: DmlElementJson | null = null
    try {
      ast = parse(inner)
    } catch {
      // tolerant: skip this block on binding failure
    }
    blocks.push({ span: [start, end], root: ast ? fromCompilerAst(ast, base) : null })
    cursor = end
  }
  return { blocks, errors }
}

/** Convert a @tsdml/compiler DmlElementJson into the editor DmlNode forest,
 *  attaching each node's parent tag name. `base` = the block-inner start in
 *  FILE coordinates (spans from the compiler are relative to the inner text). */
export function fromCompilerAst(
  root: DmlElementJson | null,
  base: number,
): DmlNode | null {
  if (!root) return null
  const convEl = (el: DmlElementJson, parentTag?: string): DmlNode => {
    const node: DmlNode = {
      kind: "element",
      name: el.name,
      span: shiftSpan(el.span, base),
      parentTag,
      members: [],
    }
    node.members = (el.members ?? []).map((m) => convMember(m, el.name))
    return node
  }
  const convMember = (m: DmlMemberJson, parentTag: string): DmlNode => {
    if (m.kind === "element") return convEl(m as DmlElementJson, parentTag)
    if (m.kind === "attribute") {
      return {
        kind: "attribute",
        name: m.name,
        span: shiftSpan(m.nameSpan, base),
        valueSpan: shiftSpan(m.valueSpan, base),
        value: m.value,
        parentTag,
      }
    }
    if (m.kind === "text") {
      return { kind: "text", text: m.value, span: shiftSpan(m.span, base), parentTag }
    }
    if (m.kind === "expr") {
      return { kind: "expr", text: m.value, span: shiftSpan(m.span, base), parentTag }
    }
    if (m.kind === "sequence") {
      return {
        kind: "sequence",
        members: (m.items ?? []).map((im) => convMember(im, parentTag)),
        parentTag,
      }
    }
    if (m.kind === "macroCall") {
      // `@name(...) { body }` — the head stays raw (a registered macro
      // component interprets it); the editor reads `@slot`/`@template` names
      // out of it for slot completion.
      return {
        kind: "macroCall",
        name: m.name,
        span: shiftSpan(m.nameSpan, base),
        headSrc: m.headSrc,
        headSpan: shiftSpan(m.headSpan, base),
        members: (m.items ?? []).map((im) => convMember(im, parentTag)),
        parentTag,
      }
    }
    // namespaceScope — keep prefix + recurse inner under same parent tag
    return {
      kind: "namespaceScope",
      prefix: m.prefix,
      inner: (m.inner ?? []).map((im) => convMember(im, parentTag)),
      parentTag,
    }
  }
  return convEl(root)
}

function shiftSpan(
  s: { start: number; end: number } | null | undefined,
  base: number,
): { start: number; end: number } | null {
  if (!s) return null
  return { start: s.start + base, end: s.end + base }
}

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

/** A quoted string head, e.g. `"footer"` → `footer`. */
function unquoteHead(headSrc: string | undefined): string | undefined {
  if (!headSrc) return undefined
  const s = headSrc.trim()
  const inner = s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
  return inner.length ? inner : undefined
}

/**
 * The slot names a component **declares** — the `@slot("name") { … }` outlets
 * in its template. This is what a caller of `@template("name")` may fill, so
 * it is the completion source at that position.
 *
 * Declared, not inferred from props: an outlet is the component's contract,
 * and a name that only appears in the props type but has no outlet is not a
 * slot the component renders.
 */
export function slotNamesOf(root: DmlNode | null | undefined): string[] {
  const out = new Set<string>()
  const walk = (node: DmlNode | null | undefined) => {
    if (!node) return
    if (node.kind === "macroCall" && node.name === "slot") {
      const name = unquoteHead(node.headSrc)
      if (name) out.add(name)
    }
    for (const m of node.members ?? []) walk(m)
    for (const m of node.inner ?? []) walk(m)
  }
  walk(root)
  return [...out].sort()
}

/**
 * Is `offset` inside the slot-name string of a `@template("…")` /
 * `@slot("…")` head? Returns the macro name and the text typed so far (the
 * completion prefix), read straight from `source`.
 */
export function slotNameHitAt(
  source: string,
  blocks: Array<{ span: [number, number]; root: DmlNode | null }>,
  offset: number,
): { macro: "template" | "slot"; prefix: string } | undefined {
  const hit = hitAtOffset(blocks, offset)
  if (hit?.role !== "macroHead") return undefined
  const hs = hit.node.headSpan
  if (!hs) return undefined
  // prefix = everything between the opening quote and the caret
  const quote = source.indexOf('"', hs.start)
  const from = quote === -1 ? hs.start : quote + 1
  return {
    macro: hit.node.name === "slot" ? "slot" : "template",
    prefix: source.slice(from, offset),
  }
}

// ---------------------------------------------------------------------------
// offset routing
// ---------------------------------------------------------------------------
export type HitNode =
  | { role: "tag"; node: DmlNode; text: string }
  | { role: "attrName"; node: DmlNode; text: string }
  | { role: "attrValue"; node: DmlNode; text: string; attrName: string }
  | { role: "text"; node: DmlNode; text: string }
  | { role: "expr"; node: DmlNode; text: string }
  | { role: "macroName"; node: DmlNode; text: string }
  /** inside the `("…")` head of a `@template`/`@slot` — the slot name */
  | { role: "macroHead"; node: DmlNode; text: string }

/** Walk all blocks; find the deepest node whose span contains `offset`.
 *  Returns the first hit across blocks (documents have disjoint spans). */
export function hitAtOffset(
  blocks: Array<{ span: [number, number]; root: DmlNode | null }>,
  offset: number,
): HitNode | undefined {
  for (const b of blocks) {
    if (offset < b.span[0] || offset > b.span[1]) continue
    if (!b.root) continue
    let best: DmlNode | undefined
    let bestArea = Number.POSITIVE_INFINITY
    /** a `@template("…")` head containing the caret (more specific than any
     *  enclosing node, so it wins outright) */
    let headHit: DmlNode | undefined
    const walk = (n: DmlNode) => {
      // The macro head is its own answer: the slot name lives inside the
      // quotes and the editor completes it from the component's outlets.
      if (n.kind === "macroCall" && n.headSpan) {
        const hs = n.headSpan
        if (offset >= hs.start && offset <= hs.end) headHit = n
      }
      const s = n.span
      if (s) {
        // caret at end-of-span counts as inside (right after last typed char)
        const contains = offset >= s.start && offset <= s.end
        if (contains) {
          const area = s.end - s.start
          if (area < bestArea) {
            bestArea = area
            best = n
          }
        }
      }
      if (n.members) for (const c of n.members) walk(c)
      if (n.inner) for (const c of n.inner) walk(c)
    }
    walk(b.root)
    if (headHit) {
      return { role: "macroHead", node: headHit, text: "" }
    }
    if (!best) return undefined
    switch (best.kind) {
      case "element":
        return { role: "tag", node: best, text: best.name ?? "" }
      case "attribute": {
        const vs = best.valueSpan
        if (vs && offset >= vs.start && offset <= vs.end) {
          return {
            role: "attrValue",
            node: best,
            text: sourceForValue(offset, vs),
            attrName: best.name ?? "",
          }
        }
        return { role: "attrName", node: best, text: best.name ?? "" }
      }
      case "text":
        return { role: "text", node: best, text: best.text ?? "" }
      case "expr":
        return { role: "expr", node: best, text: best.text ?? "" }
      case "macroCall":
        return { role: "macroName", node: best, text: best.name ?? "" }
      default:
        return undefined
    }
  }
  return undefined
}

/** The value text under the caret, from the compiler's value node if present,
 *  else best-effort from the raw span (typing prefix). */
function sourceForValue(offset: number, vs: { start: number; end: number }): string {
  void offset
  void vs
  return "" // value node text resolved by caller from node.value
}

// ---------------------------------------------------------------------------
// completions
// ---------------------------------------------------------------------------
export interface CompletionItem {
  label: string
  kind: "field" | "method" | "property" | "constant" | "text"
  detail?: string
  /** true when the user is mid-typing (filter the list by prefix) */
  filterText?: string
}

/** All tags of the IntrinsicElements table, sorted. */
export function tagCompletions(model: DtsModel, prefix: string): CompletionItem[] {
  const tags = [...model.ifaceOfTag.keys()].sort()
  const p = prefix.toLowerCase()
  const list = tags
    .filter((t) => !p || t.toLowerCase().startsWith(p))
    .map((t) => ({
      label: t,
      kind: "field" as const,
      detail: model.ifaceOfTag.get(t),
    }))
  return list
}

/** All props of the tag under `parentTag` (own + inherited). kind=field. */
export function attrCompletions(
  model: DtsModel,
  parentTag: string,
  prefix: string,
): CompletionItem[] {
  const typeExpr = model.ifaceOfTag.get(parentTag)
  if (!typeExpr) return []
  const p = prefix.toLowerCase()
  const seen = new Set<string>()
  const out: CompletionItem[] = []
  for (const m of model.allMembersOf(typeExpr)) {
    if (seen.has(m.name)) continue
    seen.add(m.name)
    if (p && !m.name.toLowerCase().startsWith(p)) continue
    out.push({
      label: m.name,
      kind: "field",
      detail: `${m.optional ? "?" : ""}${m.sig}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// hover data (raw text, caller renders markdown)
// ---------------------------------------------------------------------------
export interface HoverInfo {
  kind: "tag" | "attrName"
  /** the tag or attr the caret is on */
  text: string
  /** for attrName: owning element tag */
  parentTag?: string
  /** resolved d.ts declaration for attrName (line 1-based, signature) */
  member?: { line: number; sig: string; optional: boolean }
  /** the props interface type expr for a tag hover */
  typeExpr?: string
}

export function hoverInfo(
  hit: HitNode,
  model: DtsModel,
): HoverInfo | undefined {
  if (hit.role === "tag") {
    const typeExpr = model.ifaceOfTag.get(hit.text)
    if (!typeExpr) return undefined
    const ifName = typeExpr.replace(/<.*/, "")
    const body = model.ifaceBody.get(ifName)
    return {
      kind: "tag",
      text: hit.text,
      typeExpr,
      member: body ? undefined : undefined,
    }
  }
  if (hit.role === "attrName") {
    const parent = hit.node.parentTag
    if (!parent) return undefined
    const typeExpr = model.ifaceOfTag.get(parent)
    if (!typeExpr) return undefined
    const member = model.membersOf(typeExpr, hit.text)
    return {
      kind: "attrName",
      text: hit.text,
      parentTag: parent,
      member: member
        ? { line: member.line, sig: member.sig, optional: member.optional }
        : undefined,
    }
  }
  return undefined
}


