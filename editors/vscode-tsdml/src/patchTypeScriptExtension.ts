// Extension-host side: make the built-in TypeScript extension treat `.tsdml`
// as a supported TS document and preload our tsserver patch on every tsserver
// launch (see patch-tsserver-tsdml.ts, which makes the TS compiler accept
// `.tsdml` module specifiers so `import "./x.tsdml"` resolves, no TS2307).
//
// Mirrors the Vue toolchain (vuejs/language-tools extensions/vscode/src/
// extension.ts patchTypeScriptExtension) which does the same for `.vue`:
//  - monkey-patch fs.readFileSync so the TS extension's bundle is read with
//    `.tsdml` inserted into its language-mode lists, then hot-reload the
//    already-loaded module through that patched read (delete + re-require +
//    Object.assign so all internal references, including the tsserver spawn
//    call, come from the patched bundle and carry our --require injection);
//  - additionally monkey-patch child_process.spawn/fork as a belt-and-braces
//    so ANY tsserver process launched after activation gets --require'd.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('node:path') as typeof import('node:path')
import * as vscode from 'vscode'

export function patchTypeScriptExtension(): boolean {
	const tsExtension = vscode.extensions.getExtension('vscode.typescript-language-features')
	if (!tsExtension) return false

	const child_process = require('node:child_process') as typeof import('node:child_process')
	const extensionJsPath = require.resolve('./dist/extension.js', { paths: [tsExtension.extensionPath] })
	const patchTsserverPath = path.join(__dirname, 'patch-tsserver-tsdml.js')
	const dbg = (msg: string) => {
		try {
			fs.appendFileSync(process.env.TEMP + '/tsdml-patch.log', new Date().toISOString() + ' ' + msg + '\n')
		} catch {}
	}
	dbg('patchTypeScriptExtension: isActive=' + tsExtension.isActive + ' extJs=' + extensionJsPath + ' patch=' + patchTsserverPath)

	const readFileSync = fs.readFileSync
	fs.readFileSync = (...args: any[]) => {
		if (args[0] === extensionJsPath) {
			let text = readFileSync(...(args as [any])) as string

			const id = String.raw`[\w$]+(?:\.[\w$]+)?`

			// jsTsLanguageModes gets a 5th language mode (post-1.110 format)
			text = text.replace(
				new RegExp(
					String.raw`(\.jsTsLanguageModes=\[${id},${id},${id},${id}\])|("javascriptreact",(${id})=\[(${id},${id},${id},${id})\])`,
				),
				(_match: string, oldFormat?: string, _newFull?: string, newLhs?: string, newElements?: string) => {
					if (oldFormat) return oldFormat + '.concat("tsdml")'
					return `"javascriptreact",${newLhs}=[${newElements}].concat("tsdml")`
				},
			)
			// isSupportedLanguageMode (4 language IDs)
			text = text.replace(
				new RegExp(String.raw`\.languages\.match\(\[(${id},${id},${id},${id})\]`),
				(_: string, ids: string) => `.languages.match([${ids}].concat("tsdml")`,
			)
			// isTypeScriptDocument (2 language IDs)
			text = text.replace(
				new RegExp(String.raw`\.languages\.match\(\[(${id},${id})\]`),
				(_: string, ids: string) => `.languages.match([${ids}].concat("tsdml")`,
			)
			// standardFileExtensions
			text = text.replace(
				new RegExp(String.raw`registerExtensionLanguageProvider\((${id}),${id}\)\{`),
				(match: string, id: string) =>
					`${match}if(${id}.languageIds.includes("tsdml"))${id}.standardFileExtensions.push("tsdml");`,
			)

			return text
		}
		return readFileSync(...(args as [any]))
	}

	// Belt-and-braces FIRST: intercept any tsserver spawn/fork (installed before
	// the hot-reload below so the reloaded TS extension picks up the hook when
	// it destructures child_process.fork/spawn).
	const spawn = child_process.spawn
	child_process.spawn = (...args: any[]) => {
		const a1 = Array.isArray(args[1]) ? args[1] : []
		dbg('spawn called: args0=' + String(args[0]).slice(0, 80) + ' a1=' + a1.slice(0, 4).map(String).join(' | ').slice(0, 200))
		if (Array.isArray(args[1])) {
			const index = args[1].findIndex((arg) => typeof arg === 'string' && isTsserverFile(arg))
			if (index !== -1) {
				args[1].splice(index, 0, '--require', patchTsserverPath)
				dbg('  INJECTED into spawn')
			}
		}
		return spawn(...(args as [any]))
	}

	const fork = child_process.fork
	child_process.fork = (...args: any[]) => {
		dbg('fork called: args0=' + String(args[0]).slice(0, 120))
		if (typeof args[0] === 'string' && isTsserverFile(args[0])) {
			const optionsIndex = Array.isArray(args[1]) ? 2 : 1
			const options = (args[optionsIndex] ??= {})
			options.execArgv = [...(options.execArgv ?? process.execArgv), '--require', patchTsserverPath]
			dbg('  INJECTED into fork')
		}
		return fork(...(args as [any]))
	}

	// Hot-reload the (possibly already loaded) TS extension through the patched
	// read so its internal spawn call carries our --require.
	const loadedModule = (require as any).cache[extensionJsPath]
	if (loadedModule) {
		dbg('hot-reload: cache hit, reloading')
		try {
			delete (require as any).cache[extensionJsPath]
			const patchedModule = require(extensionJsPath)
			Object.assign(loadedModule.exports, patchedModule)
			dbg('hot-reload: done')
		} catch (e) {
			dbg('hot-reload FAILED: ' + String(e))
			console.warn('[tsdml] TS extension hot-reload failed:', e)
		}
	} else {
		dbg('hot-reload: no cache (TS ext not loaded yet)')
	}

	function isTsserverFile(file: string) {
		return path.isAbsolute(file) && path.basename(file) === 'tsserver.js'
	}

	// true = full patch applied before TS extension loaded; false = TS
	// extension was already active (hot-reload path used).
	return !tsExtension.isActive
}
