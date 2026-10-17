// Injected into the tsserver process via `--require` (see extension.ts's
// patchTypeScriptExtension). Monkey-patches the TypeScript compiler module the
// same way the Vue toolchain patches it for `.vue`, so the compiler treats
// `.tsdml` as a supported TS extension:
//   - import "./foo.tsdml" resolves to the real on-disk file (no TS2307),
//   - the file enters the TS program where our tsdml-tsplugin already serves
//     the lowered snapshot (transform) via getScriptKind/getScriptSnapshot.
// Child tsserver processes forked by tsserver inherit execArgv and re-run this
// file; only patch when the entry itself is tsserver.js.
const fs = require('node:fs')
const path = require('node:path')

try {
	const entry = process.argv[1]
	if (entry && path.basename(entry) === 'tsserver.js') {
		const resolvedEntry = fs.realpathSync(entry)
		const typescriptPath = path.join(path.dirname(resolvedEntry), 'typescript.js')
		const readFileSync = fs.readFileSync
		fs.readFileSync = (...args: any[]) => {
			if (args[0] === typescriptPath) {
				let content: any = readFileSync(...(args as [any]))
				const before = content
				content = content.replace(
					/supportedTSExtensions = .*(?=;)/,
					(s: string) => s + `.concat([".tsdml"])`,
				)
				content = content.replace(
					/supportedJSExtensions = .*(?=;)/,
					(s: string) => s + `.concat([".tsdml"])`,
				)
				content = content.replace(
					/allSupportedExtensions = .*(?=;)/,
					(s: string) => s + `.concat([".tsdml"])`,
				)
				content = content.replace(
					/function changeExtension\(/,
					(s: string) =>
						`function changeExtension(path, newExtension) {
						return [".tsdml"].some(ext => path.endsWith(ext))
						? path + newExtension
						: _changeExtension(path, newExtension);
					}\n` + s.replace('changeExtension', '_changeExtension'),
				)
				content = content.replace(
					/const isJs = hasJSFileExtension\((.*?)\.fileName\)/,
					(_s: string, file: string) => `const isJs = isSourceFileJS(${file})`,
				)
				try {
					const changed = content !== before
					fs.appendFileSync(
						process.env.TEMP + '/tsdml-patch.log',
						new Date().toISOString() + ' [tsserver-patch] read typescript.js changed=' + changed + ' len=' + content.length + '\n',
					)
				} catch {}
				return content
			}
			return readFileSync(...(args as [any]))
		}
	}
} catch (error) {
	console.warn('[tsdml] Failed to patch tsserver:', error)
}
