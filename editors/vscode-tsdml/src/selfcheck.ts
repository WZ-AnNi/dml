/**
 * Assert-based self-check for the TSDML virtual code + mappings.
 * Runs against the BUNDLED dist (same code the extension ships).
 */
import assert from 'node:assert/strict'
import { tsdmlLanguagePlugin, TsDmlVirtualCode } from './languagePlugin'
import { FEATURE_PROBES, staleFeatures } from './compilerProbe'
import { transformSourceDetailed } from '@tsdml/transform'
import { URI } from 'vscode-uri'

const snapshotOf = (text: string) => ({
	getText: (a: number, b: number) => text.slice(a, b),
	getLength: () => text.length,
	getChangeRange: () => undefined,
})

// --- 1) plugin shape -------------------------------------------------------
const uri = URI.file('/proj/src/counter.tsdml')
assert.equal(tsdmlLanguagePlugin.getLanguageId(uri), 'tsdml')
assert.equal(tsdmlLanguagePlugin.getLanguageId(URI.file('/proj/src/main.ts')), undefined)

// --- 2) happy path: fine-grained template mappings --------------------------
const raw = `import hero from "./assets/hero.png"
export function createCounter(e: (t: string) => unknown) {
  return @{
    div {
      img { @src: hero, @class: "framework", @alt: "Solid logo" },
      button { @onClick: increment, "Count is ", { count.read() } }
    }
  }
}
`
const code = new TsDmlVirtualCode(snapshotOf(raw))

const expected = transformSourceDetailed(raw)
assert.equal(code.generatedText, expected.code)
assert.ok(!code.generatedText.includes('@{'), 'template lowered')
assert.ok(code.generatedText.includes('__dml_e('), 'typed IR calls present')
// NOTE: the transform only pads a call that SHRANK; a call that grew shifts
// everything after it — gap mappings below are offset-agnostic on purpose.
// The tail gap must still align to the very end of both texts.
const tail = code.mappings[code.mappings.length - 1]!
assert.equal(tail.sourceOffsets[0]! + tail.lengths[0], raw.length, 'tail gap reaches end of raw')
assert.equal(tail.generatedOffsets[0]! + tail.lengths[0], code.generatedText.length, 'tail gap reaches end of generated')

// gap (identity) mappings pair identical text — they are the untouched TS
// regions; template node mappings are authoritative-position (compiler-kept),
// so raw text and lowered text may differ (e.g. expr whitespace trim) and we
// only check those are in-bounds below.
for (const m of code.mappings) {
	if (m.sourceOffsets[0] === m.generatedOffsets[0] && (m.data as any).format) {
		const src = raw.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0])
		const gen = code.generatedText.slice(m.generatedOffsets[0], m.generatedOffsets[0] + m.lengths[0])
		assert.equal(src, gen, `identity mapping pairs equal text (got ${JSON.stringify(src)} vs ${JSON.stringify(gen)})`)
	}
}
// every template node mapping must be within bounds of both texts
for (const m of code.mappings) {
	if (!(m.data as any).format) {
		const srcEnd = m.sourceOffsets[0]! + m.lengths[0]!
		const genLen = code.generatedText.length
		assert.ok(m.generatedOffsets[0]! >= 0 && m.generatedOffsets[0]! <= genLen, 'lowered offset in bounds')
		assert.ok(srcEnd <= raw.length, 'raw offset in bounds')
	}
}

// Structural template tokens (tag, attr NAME, literal text) are answered by
// our own AST semantic layer — the TS service must stay OUT of them (no
// string-literal word suggestions, no fake string hover).
function mappingBy(text: string) {
	return code.mappings.find(
		m => raw.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0]) === text,
	)
}
for (const token of ['img', 'src', 'class', 'alt', 'button', 'onClick', '"Count is "']) {
	const m = mappingBy(token)
	assert.ok(m, `mapping exists for ${JSON.stringify(token)}`)
	const d = m!.data as any
	assert.equal(d.semantic, false, `${token}: TS hover suppressed`)
	assert.equal(d.completion, false, `${token}: TS completion suppressed`)
	assert.equal(d.navigation, false, `${token}: TS navigation suppressed`)
	assert.equal(d.verification, false, `${token}: TS diagnostics suppressed`)
}
// Type-carrying tokens (attr VALUE, `{ expr }`) keep full TS capabilities: TS
// is the type oracle for the expressions the template references.
for (const token of ['hero', '"framework"', '"Solid logo"', 'increment']) {
	const m = mappingBy(token)
	assert.ok(m, `mapping exists for ${JSON.stringify(token)}`)
	const d = m!.data as any
	assert.equal(d.semantic, true, `${token}: hover enabled`)
	assert.equal(d.completion, true, `${token}: completion enabled`)
	assert.equal(d.navigation, true, `${token}: navigation enabled`)
	assert.equal(d.verification, true, `${token}: diagnostics enabled`)
}
// the expr fragment: raw span includes surrounding whitespace inside `{ ... }`
const exprMapping = code.mappings.find(
	m => raw.slice(m.sourceOffsets[0]!, m.sourceOffsets[0]! + m.lengths[0]!).includes('count.read()'),
)
assert.ok(exprMapping, 'mapping exists for the { count.read() } expression')
const ed = exprMapping!.data as any
assert.equal(ed.semantic, true, 'expr: hover enabled')
assert.equal(ed.completion, true, 'expr: completion enabled')
assert.equal(ed.navigation, true, 'expr: navigation enabled')
assert.equal(ed.verification, true, 'expr: diagnostics enabled')

// --- 2c) component tokens are TypeScript-owned ------------------------------
// A Capitalized tag is a TS identifier (hover / go-to-definition must jump to
// the component) and its props come from the component's declared props type
// (completion inside the lowered props object). The template AST layer must NOT
// swallow them the way it does for host elements.
const compRaw = [
	'import { Badge } from "./Badge.tsdml"',
	'export function Wrap() {',
	'  return @{ div { Badge { @label: "x", @tone: props.tone ?? "badge" } } }',
	'}',
].join('\n')
const compCode = new TsDmlVirtualCode(snapshotOf(compRaw))
const compMappingBy = (text: string) =>
	compCode.mappings.find(
		m => compRaw.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0]) === text,
	)
const badgeTag = compMappingBy('Badge')
assert.ok(badgeTag, 'component tag mapping exists')
for (const cap of ['semantic', 'completion', 'navigation', 'verification'] as const) {
	assert.equal((badgeTag!.data as any)[cap], true, `component tag: ${cap} enabled`)
}
const badgeProp = compMappingBy('label')
assert.ok(badgeProp, 'component prop-name mapping exists')
for (const cap of ['semantic', 'completion', 'navigation', 'verification'] as const) {
	assert.equal((badgeProp!.data as any)[cap], true, `component prop: ${cap} enabled`)
}
// the host element in the same template stays AST-owned
const hostTag = compMappingBy('div')
assert.ok(hostTag, 'host tag mapping exists')
assert.equal((hostTag!.data as any).semantic, false, 'host tag: TS stays out')

// --- 3) tolerant parsing: malformed template must NOT throw and must still
// produce mappings for the fragments that parsed -----------------------------
const bad = `export const a = @{ div { @class: } }`
let threw = false
try {
	transformSourceDetailed(bad)
} catch {
	threw = true
}
assert.equal(threw, false, 'tolerant parser never throws')
const badCode = new TsDmlVirtualCode(snapshotOf(bad))
// the div tag fragment still parsed and must be mapped
assert.ok(
	badCode.mappings.some(
		m => rawBadText(m, bad) === 'div',
	),
	'partial template still maps its parsed fragments',
)
function rawBadText(m: { sourceOffsets: number[]; lengths: number[] }, src: string): string {
	return src.slice(m.sourceOffsets[0]!, m.sourceOffsets[0]! + m.lengths[0]!)
}

// --- 4) the shipped compiler understands every feature this build assumes ----
// (A stale binary is the classic "my change did not take effect" trap: the
// probe is what lets activate() say "reload the window" instead.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compiler = require('@tsdml/compiler') as Parameters<typeof staleFeatures>[0]
assert.deepEqual(staleFeatures(compiler), [], 'shipped compiler understands all probed features')
// and the probe really does detect a compiler that is missing them
const crippled = { compileWithSpans: () => ({ errors: ['nope'] }) }
assert.equal(staleFeatures(crippled).length, FEATURE_PROBES.length, 'probe detects a stale compiler')

console.log('[selfcheck] all assertions passed (tolerant path exercised)')
