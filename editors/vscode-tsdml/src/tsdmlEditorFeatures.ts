/**
 * Client-side editor features for `.tsdml` template regions — completions,
 * hover and go-to-definition answered STRAIGHT from the DML AST (semantic.ts),
 * not from lowered/forwarded TS.
 *
 * Design:
 *   - tag / attr completions are produced here with kind = Field (5) — the
 *     same brick TSX shows — never "constant" (TS's label for string
 *     literals), and they sit on identifier positions so the editor's
 *     quickSuggestions treats them as "other" and auto-triggers.
 *   - hover on a tag  → its DML prop interface (+ extends chain),
 *   - hover on an attr → its declaration signature (walking extends),
 *   - definition on a tag  → `IntrinsicElements` member line in the d.ts,
 *   - definition on an attr → the attribute declaration line in the d.ts.
 *
 * The surrounding TypeScript (imports, declarations, template expressions)
 * stays with Volar's TS service; this module only answers raw template
 * structure positions.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { parse } from '@tsdml/compiler'
import { findTemplateBlock } from '@tsdml/transform'
import {
  parseFile,
  hitAtOffset,
  tagCompletions,
  attrCompletions,
  slotNamesOf,
  slotNameHitAt,
  hoverInfo,
  parseDts,
  type DtsModel,
  type DmlNode,
} from '@tsdml/language-service'

// LSP CompletionItemKind (vscode-languageserver-protocol numbers):
// Text=1 Method=2 Function=3 Constructor=4 Field=5 Variable=6 Class=7
// Interface=8 Module=9 Property=10 Constant=21 …
const KIND_FIELD = 5
const KIND_TEXT = 1

// ---------------------------------------------------------------------------
// locating @dml/runtime-dom's tsdml-runtime.d.ts (walk up from the document)
// ---------------------------------------------------------------------------
function findRuntimeDts(doc: vscode.TextDocument): string | undefined {
  let dir = path.dirname(doc.uri.fsPath)
  for (;;) {
    for (const rel of ['src/tsdml-runtime.d.ts', 'dist/index.d.mts']) {
      const c = path.join(dir, 'node_modules', '@dml', 'runtime-dom', rel)
      if (fs.existsSync(c)) return c
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function loadModel(doc: vscode.TextDocument): { dts: string; model: DtsModel; text: string } | undefined {
  const dts = findRuntimeDts(doc)
  if (!dts) return undefined
  const text = fs.readFileSync(dts, 'utf8')
  return { dts, model: parseDts(text), text }
}

// ---------------------------------------------------------------------------
// per-document semantic snapshot (parse once per text version)
// ---------------------------------------------------------------------------
const docCache = new WeakMap<vscode.TextDocument, { version: number; blocks: ReturnType<typeof parseFile>['blocks'] }>()

function blocksFor(doc: vscode.TextDocument) {
  const hit = docCache.get(doc)
  if (hit && hit.version === doc.version) return hit.blocks
  const raw = doc.getText()
  const blocks = parseFile(
    raw,
    (dml) => JSON.parse(JSON.stringify(parse(dml))) as ReturnType<typeof parse>,
    findTemplateBlock as (src: string, from: number) => [number, number] | null,
  ).blocks
  docCache.set(doc, { version: doc.version, blocks })
  return blocks
}

function hitAt(doc: vscode.TextDocument, offset: number) {
  return hitAtOffset(blocksFor(doc), offset)
}

/** Text under the caret (for prefix filtering): chars back from the caret that
 *  are identifier-ish OR a leading `@` (attr context marker). */
function wordBefore(doc: vscode.TextDocument, pos: vscode.Position): string {
  const line = doc.lineAt(pos).text
  let i = pos.character - 1
  while (i >= 0 && /[A-Za-z0-9_\-:@]/.test(line[i] ?? '')) i--
  return line.slice(i + 1, pos.character)
}

/** All template blocks' root elements flattened — to test "caret inside a block". */
function offsetInTemplate(blocks: ReturnType<typeof parseFile>['blocks'], offset: number): boolean {
  return blocks.some((b) => offset >= b.span[0] && offset <= b.span[1])
}

/**
 * When the caret sits on whitespace with no parsed node (e.g. just after `@`
 * or a fresh line), find the innermost element whose body contains `offset`
 * by scanning the raw block text: track brace depth, remember the most recent
 * `name {` whose body is still open at `offset`.
 */
function nearestElementTag(
  blocks: ReturnType<typeof parseFile>['blocks'],
  offset: number,
  doc: vscode.TextDocument,
): string | undefined {
  const block = blocks.find((b) => offset >= b.span[0] && offset <= b.span[1])
  if (!block) return undefined
  const text = doc.getText()
  const s = block.span[0]
  let depth = 0
  let lastTag: string | undefined
  // scan tag starts + braces up to offset
  const re = /([A-Za-z][\w-]*)\s*\{|([{}])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text.slice(s, offset)))) {
    if (m[2] === '{') depth++
    else if (m[2] === '}') depth--
    else {
      // tag open: it opens a body; if depth was 0 we're at element level
      depth++
      lastTag = m[1]
    }
  }
  return depth > 0 ? lastTag : undefined
}

// ---------------------------------------------------------------------------
// slot completion: the component's declared `@slot("name")` outlets
// ---------------------------------------------------------------------------

/** The enclosing component tag of a macro call (`parentTag` from the AST). */
function enclosingComponentTag(
  blocks: ReturnType<typeof parseFile>['blocks'],
  offset: number,
  doc: vscode.TextDocument,
): string | undefined {
  const hit = hitAtOffset(blocks, offset)
  if (hit?.node.parentTag) return hit.node.parentTag
  return nearestElementTag(blocks, offset, doc)
}

/** Resolve a component's import specifier to a file on disk. Follows the
 *  document's own `import { Panel } from "…"` — no TS program needed. */
function resolveComponentFile(
  doc: vscode.TextDocument,
  tag: string,
): string | undefined {
  const re = new RegExp(`import\\s*\\{[^}]*\\b${tag}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`)
  const m = re.exec(doc.getText())
  if (!m) return undefined
  const spec = m[1]
  if (!spec.startsWith('.')) return undefined // bare specifier: not ours
  const base = path.dirname(doc.uri.fsPath)
  const abs = path.resolve(base, spec)
  for (const cand of [abs, `${abs}.tsdml`, path.join(abs, 'index.tsdml')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return undefined
}

/** The slot names a component declares, or [] when it declares none / cannot
 *  be resolved. Parsed straight from its `.tsdml` template. */
function componentSlotNames(doc: vscode.TextDocument, tag: string): string[] {
  const file = resolveComponentFile(doc, tag)
  if (!file) return []
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  let blocks
  try {
    blocks = parseFile(
      text,
      (dml) => JSON.parse(JSON.stringify(parse(dml))) as ReturnType<typeof parse>,
      findTemplateBlock as (src: string, from: number) => [number, number] | null,
    ).blocks
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const b of blocks) for (const n of slotNamesOf(b.root)) names.add(n)
  return [...names].sort()
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------
export function registerTsdmlTemplateFeatures(context: vscode.ExtensionContext): void {
  // ---- completions (AST-answered; field kind) ----
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'tsdml',
    {
      async provideCompletionItems(doc, pos) {
        try {
          const offset = doc.offsetAt(pos)
          const blocks = blocksFor(doc)
          if (!offsetInTemplate(blocks, offset)) return undefined
          const prefix = wordBefore(doc, pos)
          const items: vscode.CompletionItem[] = []
          const hit = hitAt(doc, offset)

          // Slot-name position first: it needs only the AST plus the component
          // file, so it must not sit behind the d.ts model lookup (which is
          // absent until @dml/runtime-dom is installed).
          const slotCtx = slotNameHitAt(doc.getText(), blocks, offset)
          if (slotCtx) {
            const tag = enclosingComponentTag(blocks, offset, doc)
            const names = tag ? componentSlotNames(doc, tag) : []
            for (const n of names) {
              if (
                slotCtx.prefix &&
                !n.toLowerCase().startsWith(slotCtx.prefix.toLowerCase())
              ) {
                continue
              }
              const it = new vscode.CompletionItem(n, KIND_FIELD)
              it.detail = `@${slotCtx.macro} slot of ${tag ?? ''}`
              items.push(it)
            }
            // an empty list is only honest when the component was resolved and
            // really declares no slots — otherwise say nothing
            if (items.length === 0 && tag) return undefined
            if (items.length > 0) return new vscode.CompletionList(items, false)
          }

          const mod = loadModel(doc)
          if (!mod) return undefined

        // Deciding context:
        //   - prefix starts with '@'            → INSIDE an attr slot → props.
        //   - hit says attrName                  → props.
        //   - hit is tag / text / undefined      → child element slot → tags.
        //   - attr value / { expr } hits         → TS oracle (Volar) — skip.
        const attrCtx = prefix.startsWith('@') || hit?.role === 'attrName'
        const tagCtx = !attrCtx && (!hit || hit.role === 'tag' || hit.role === 'text')

        if (attrCtx) {
          const p = prefix.replace(/^@/, '')
          const parentTag = hit?.node.parentTag ?? nearestElementTag(blocks, offset, doc)
          if (parentTag) {
            for (const a of attrCompletions(mod.model, parentTag, p)) {
              const it = new vscode.CompletionItem(a.label, KIND_FIELD)
              it.detail = a.detail ? `@${a.label}${a.detail.startsWith('?') ? '' : '?:'} ${a.detail}` : undefined
              items.push(it)
            }
          }
        } else if (tagCtx) {
          // tag position (or whitespace where a child element would start):
          // offer IntrinsicElements. kind = Field (TSX-brick).
          const p = hit?.role === 'tag' || hit?.role === 'text' ? prefix : ''
          for (const t of tagCompletions(mod.model, p)) {
            const it = new vscode.CompletionItem(t.label, KIND_FIELD)
            it.detail = t.detail ? `DML.IntrinsicElements["${t.label}"] = ${t.detail}` : undefined
            items.push(it)
          }
        }
        // attrValue / expr hits: no structural list here — the TS oracle
        // (Volar) answers those; returning undefined lets it.
        if (items.length === 0) return undefined
        return new vscode.CompletionList(items, false)
        } catch (err) {
          console.log('[tsdmlsem] provider error:', err instanceof Error ? (err.stack || err.message) : String(err))
          return undefined
        }
      },
    },
    // `@` (attrs), `"` and `(` (a slot name is a quoted string inside a macro
    // head, and VS Code does not auto-trigger inside string literals).
    '@', '"', '(',
  )

  // ---- hover (AST-answered) ----
  const hoverProvider = vscode.languages.registerHoverProvider('tsdml', {
    async provideHover(doc, pos) {
      const hit = hitAt(doc, doc.offsetAt(pos))
      if (!hit) return undefined
      const mod = loadModel(doc)
      const md = new vscode.MarkdownString()
      const h = mod ? hoverInfo(hit, mod.model) : undefined
      if (hit.role === 'tag') {
        md.appendCodeblock(`e(${JSON.stringify(hit.text)}, props, children?)`, 'typescript')
        if (!h?.typeExpr) {
          md.appendMarkdown(`Intrinsic element \`${hit.text}\` — add @dml/runtime-dom to resolve prop types`)
          return new vscode.Hover(md)
        }
        const typeExpr = h.typeExpr
        const ifName = typeExpr.replace(/<.*/, '')
        const body = mod!.model.ifaceBody.get(ifName)
        const count = body ? body.members.length : 0
        md.appendMarkdown(
          `**\`${hit.text}\`** — \`DML.IntrinsicElements["${hit.text}"]\` = \`${typeExpr}\`\n\n` +
            `${count} own props` +
            (body && body.extends.length ? `, extends \`${body.extends.join(', ')}\`` : '') +
            '\n\n',
        )
        md.appendCodeblock(
          `interface ${ifName}${typeExpr.includes('<') ? typeExpr.slice(typeExpr.indexOf('<')) : ''}`,
          'typescript',
        )
        return new vscode.Hover(md)
      }
      if (hit.role === 'attrName') {
        if (!h) return undefined
        md.appendMarkdown(`**\`@${hit.text}\`** on \`<${h.parentTag}>\`\n\n`)
        if (h.member) {
          md.appendMarkdown(`\`\`\`typescript\n@${hit.text}${h.member.optional ? '?' : ''}: ${h.member.sig};\n\`\`\``)
        } else {
          md.appendMarkdown(`(not declared on \`${h.typeExpr}\` or its bases)`)
        }
        return new vscode.Hover(md)
      }
      return undefined
    },
  })

  // ---- definition (AST-answered, jumps to d.ts lines) ----
  const defProvider = vscode.languages.registerDefinitionProvider('tsdml', {
    async provideDefinition(doc, pos) {
      const hit = hitAt(doc, doc.offsetAt(pos))
      if (!hit) return undefined
      const mod = loadModel(doc)
      if (!mod) return undefined
      const target = vscode.Uri.file(mod.dts)
      const h = hoverInfo(hit, mod.model)
      if (hit.role === 'tag') {
        if (!h?.typeExpr) return undefined
        const re = new RegExp(`^\\s*${hit.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'm')
        const m = re.exec(mod.text)
        const line = m ? mod.text.slice(0, m.index).split('\n').length : 1
        return [new vscode.Location(target, new vscode.Position(line - 1, 0))]
      }
      if (hit.role === 'attrName' && h?.member) {
        return [new vscode.Location(target, new vscode.Position(h.member.line - 1, 0))]
      }
      return undefined
    },
  })

  context.subscriptions.push(completionProvider, hoverProvider, defProvider)
}

// keep the type import used (semantic root fn signature reference)
export type { DmlNode }
