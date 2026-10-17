// Tokenize a file with a tmLanguage grammar and print scopes per line.
// Usage: node scripts/tokenize.cjs <grammar.json> <file>
const fs = require('node:fs')
const path = require('node:path')
const vscodeTextmate = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')

const wasmBin = fs.readFileSync(path.join(__dirname, '../node_modules/vscode-oniguruma/release/onig.wasm')).buffer

const onigLib = oniguruma.loadWASM(wasmBin).then(() => ({
	createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
	createOnigString: s => new oniguruma.OnigString(s),
}))

const registry = new vscodeTextmate.Registry({
	onigLib,
	loadGrammar: async scopeName => {
		const grammarPath =
			process.argv[3] ?? path.join(__dirname, '..', '..', 'vscode-dml', 'syntaxes', 'dml.tmLanguage.json')
		const raw = fs.readFileSync(grammarPath, 'utf8')
		return vscodeTextmate.parseRawGrammar(raw, grammarPath)
	},
})

async function main() {
	const grammar = await registry.loadGrammar('source.dml')
	const text = fs.readFileSync(process.argv[2], 'utf8')
	const lines = text.split(/\r?\n/)
	lines.forEach((line, i) => {
		const r = grammar.tokenizeLine(line, i === 0 ? null : prevState)
		prevState = r.ruleStack
		const segs = []
		let last = 0
		for (const t of r.tokens) {
			const seg = line.slice(last, t.startIndex)
			if (seg) segs.push(JSON.stringify(seg))
			segs.push(`[${t.scopes.slice(-1)[0]}]`)
			last = t.startIndex
		}
		if (last < line.length) segs.push(JSON.stringify(line.slice(last)))
		console.log(`${String(i + 1).padStart(2)}: ${segs.join(' ')}`)
	})
}
let prevState = null
main()
