/**
 * TSDML language plugin for Volar.
 *
 * A `.tsdml` file is a TypeScript module with DML template blocks (`@{ ... }`).
 * The virtual code lowers the whole file to TypeScript via `@tsdml/transform`
 * and builds Volar `CodeMapping`s that tell the framework how positions map
 * between the editor's raw text and the generated TS text:
 *
 *   - TypeScript regions (imports, signatures, statements): identity mappings
 *     with all capabilities — hover/completion/jump in the surrounding TS is
 *     byte-exact.
 *   - Template block regions: the AUTHORITATIVE raw↔lowered node map produced
 *     by the Rust compiler (`compileWithSpans`) — each template token (element
 *     tag, `@attr`, values, text, `{ expr }`) maps to its exact lowered
 *     counterpart, so hover / go-to-definition / completion / diagnostics land
 *     on the right token even while the template is incomplete (the tolerant
 *     parser recovers instead of throwing). Fragments that failed to parse
 *     simply produce no mapping; the editor falls back to the nearest one.
 *
 * No heuristic re-scanning: the compiler owns the mapping.
 */
import { type CodeMapping, type LanguagePlugin, type VirtualCode } from '@volar/language-core'
import { findTemplateBlock, transformSourceDetailed, type EditorNodeSpan } from '@tsdml/transform'
import type * as ts from 'typescript'
import { URI } from 'vscode-uri'

const ALL_CAPS = {
	completion: true,
	format: true,
	navigation: true,
	semantic: true,
	structure: true,
	verification: true,
} as const

/**
 * Structure-only template regions (element tag, attr NAME, literal text):
 * language data is answered by the client-side AST semantic layer, so the TS
 * service must NOT forward anything for them (no string-literal word
 * suggestions, no fake string hover) — all capabilities off.
 */
const STRUCT_CAPS = {
	completion: false,
	format: false,
	navigation: false,
	semantic: false,
	structure: false,
	verification: false,
} as const

/** Roles the template AST layer owns (everything else is TS's). */
const STRUCT_ROLES: readonly string[] = ['tag', 'attrName', 'text']

/**
 * Type-carrying template regions (attr VALUE, `{ expr }`): these hold real TS
 * expressions, so they keep full TS capabilities — TS is the type oracle for
 * them, exactly as designed.
 */
const TYPE_CAPS = {
	completion: true,
	format: false,
	navigation: true,
	semantic: true,
	structure: false,
	verification: true,
} as const

/**
 * The TS-server plugin decorates a host whose `scriptId` may arrive as a
 * `URI` (volar) OR a plain path string (when other plugins in the decoration
 * chain have already converted it). Normalize before probing extensions.
 */
function asFileName(scriptId: URI | string | undefined): string | undefined {
	if (!scriptId) return undefined
	return typeof scriptId === 'string' ? scriptId : scriptId.path
}

function isTsdmlScriptId(scriptId: URI | string | undefined): boolean {
	const fileName = asFileName(scriptId)
	return !!fileName && fileName.endsWith('.tsdml')
}

export const tsdmlLanguagePlugin: LanguagePlugin<URI> = {
	getLanguageId(scriptId) {
		if (isTsdmlScriptId(scriptId)) {
			return 'tsdml'
		}
	},
	createVirtualCode(scriptId, _languageId, snapshot) {
		if (isTsdmlScriptId(scriptId)) {
			return new TsDmlVirtualCode(snapshot)
		}
	},
	updateVirtualCode(_uri, _code, snapshot) {
		return new TsDmlVirtualCode(snapshot)
	},
	typescript: {
		extraFileExtensions: [{ extension: 'tsdml', isMixedContent: true, scriptKind: 3 satisfies ts.ScriptKind.TS }],
		getServiceScript(root) {
			if (root instanceof TsDmlVirtualCode) {
				return {
					code: root,
					extension: '.ts',
					scriptKind: 3 satisfies ts.ScriptKind.TS,
					// Our snapshot already preserves line structure (the lowering is
					// in-place), so no extra line padding is needed on top.
					preventLeadingOffset: true,
				}
			}
		},
	},
}

export class TsDmlVirtualCode implements VirtualCode {
	id = 'root'
	languageId = 'typescript'
	mappings: CodeMapping[]
	embeddedCodes: VirtualCode[] = []
	/** The lowered TS text. Same length as raw (the transform pads each block). */
	generatedText: string

	constructor(snapshot: ts.IScriptSnapshot) {
		const raw = snapshot.getText(0, snapshot.getLength())
		let mappings: CodeMapping[] = [{ sourceOffsets: [0], generatedOffsets: [0], lengths: [raw.length], data: { ...ALL_CAPS } }]
		let generatedText = raw
		try {
			const detailed = transformSourceDetailed(raw)
			generatedText = detailed.code
			mappings = buildMappings(
				raw,
				generatedText,
				detailed.templateSpans,
				detailed.blockNodes,
				detailed.baseOffset,
			)
		} catch {
			// Native transform failed (e.g. binding missing). Serve the raw
			// text as TS with an identity mapping so the editor stays alive.
		}
		this.generatedText = generatedText
		this.mappings = mappings
		this.snapshot = {
			getText: (start, end) => generatedText.slice(start, end),
			getLength: () => generatedText.length,
			getChangeRange: () => undefined,
		}
	}

	snapshot: ts.IScriptSnapshot
}

/**
 * Build Volar mappings for the lowered text.
 *
 * TypeScript gaps (outside `@{ }`) map identity with all capabilities.
 * Inside each block, every authoritative node span from the Rust compiler
 * becomes one CodeMapping (exact raw↔lowered offsets, verbatim-verified by
 * the compiler). Remaining block scaffolding (`@{`, `}`, whitespace,
 * unparsed fragments) maps to nothing — the editor falls back to the nearest
 * mapping, which is fine because those positions carry no language value.
 */
function buildMappings(
	raw: string,
	generated: string,
	templateSpans: Array<[number, number]>,
	blockNodes: Array<Array<EditorNodeSpan>>,
	baseOffset = 0,
): CodeMapping[] {
	const mappings: CodeMapping[] = []
	let srcCursor = 0
	// The generated text starts with the editor prologue (the injected typed-IR
	// binding), so identity gaps begin at that offset.
	let genCursor = baseOffset
	for (let blockIndex = 0; blockIndex < templateSpans.length; blockIndex++) {
		const block = findTemplateBlock(raw, srcCursor)
		if (!block) {
			break
		}
		const [blockStart, blockEnd] = block
		const [genStart, genEnd] = templateSpans[blockIndex]!

		// TypeScript gap before the block — identical text, possibly shifted
		// offsets if an earlier block grew.
		const gapLen = blockStart - srcCursor
		if (gapLen > 0) {
			mappings.push({
				sourceOffsets: [srcCursor],
				generatedOffsets: [genCursor],
				lengths: [gapLen],
				data: { ...ALL_CAPS },
			})
		}

		// Authoritative node mappings for this block.
		const nodes = blockNodes[blockIndex] ?? []
		// Only keep nodes fully inside the block (sanity against any skew).
		for (const node of nodes) {
			const rawStart = node.raw[0]
			const rawEnd = node.raw[1]
			const loweredStart = node.lowered[0]
			const loweredEnd = node.lowered[1]
			if (rawStart < blockStart || rawEnd > blockEnd) {
				// skew — ignore; coarse gap below still covers the block
				continue
			}
			mappings.push({
				sourceOffsets: [rawStart],
				generatedOffsets: [loweredStart],
				lengths: [rawEnd - rawStart],
				data: {
					// Element structure (tag / attr-name / literal text) → handled
					// by the client AST semantic layer; TS must stay out (no
					// string-word suggestions, no fake hover).
					//
					// Everything else carries real TypeScript and keeps full TS
					// capability: attr VALUE / `{ expr }`, and — for components —
					// the component IDENTIFIER (hover/jump to its definition) and
					// its props (completion from the declared props type).
					...((STRUCT_ROLES as readonly string[]).includes(node.role)
						? STRUCT_CAPS
						: TYPE_CAPS),
				},
			})
		}

		// Advance cursors past the block. The generated block region is the
		// call plus (at most) padding spaces up to the original block length.
		srcCursor = blockEnd
		genCursor = genStart + Math.max(genEnd - genStart, blockEnd - blockStart)
	}
	if (raw.length > srcCursor) {
		mappings.push({
			sourceOffsets: [srcCursor],
			generatedOffsets: [genCursor],
			lengths: [raw.length - srcCursor],
			data: { ...ALL_CAPS },
		})
	}
	return mappings
}
