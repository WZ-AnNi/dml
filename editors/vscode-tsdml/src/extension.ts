import * as serverProtocol from '@volar/language-server/protocol'
import { createLabsInfo, getTsdk } from '@volar/vscode'
import { type LanguageClientOptions, type ServerOptions, LanguageClient, TransportKind } from '@volar/vscode/node'
import * as vscode from 'vscode'
import { staleFeatures } from './compilerProbe'
import { registerTsdmlTemplateFeatures } from './tsdmlEditorFeatures'
import { registerTsdmlDiagnostics } from './tsdmlDiagnostics'
import { patchTypeScriptExtension } from './patchTypeScriptExtension'

let client: LanguageClient

/**
 * A rebuilt `@tsdml/compiler` does not reach an already-running extension host:
 * it keeps the native image it loaded at activate time. Detect that (the loaded
 * compiler cannot parse a construct this build relies on) and say so, instead
 * of letting the stale binary turn templates into TypeScript syntax errors.
 */
async function warnIfCompilerIsStale(): Promise<void> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const compiler = require('@tsdml/compiler') as Parameters<typeof staleFeatures>[0]
		const stale = staleFeatures(compiler)
		if (stale.length === 0) return
		const message =
			`TSDML: the loaded compiler is older than this extension (it does not understand ${stale.join(', ')}). ` +
			'Reload the window to pick up the rebuilt compiler.'
		console.warn('[tsdml]', message)
		const pick = await vscode.window.showWarningMessage(message, 'Reload Window')
		if (pick === 'Reload Window') {
			void vscode.commands.executeCommand('workbench.action.reloadWindow')
		}
	} catch (error) {
		console.warn('[tsdml] compiler probe failed:', error)
	}
}

export async function activate(context: vscode.ExtensionContext) {
	void warnIfCompilerIsStale()
	// Before anything TS-related loads: make the built-in TS extension treat
	// `.tsdml` as a TS document and preload our tsserver compiler patch so
	// `import "./x.tsdml"` resolves (no TS2307).
	const patched = patchTypeScriptExtension()
	if (!patched) {
		// The TypeScript extension was already active when we got here (its
		// tsserver may already be running unpatched). The spawn hooks are live
		// for the NEXT tsserver; restart it once so the fresh process loads the
		// .tsdml extension patch (resolves TS2307 on *.tsdml imports).
		setTimeout(() => {
			void vscode.commands.executeCommand('typescript.restartTsServer')
		}, 800)
	}
	// Template tags lower to STRING LITERALS (`e("div")`) — TS gives those no
	// hover and no go-to-definition, so we add client-side features for the
	// template's tag/attr regions (driven by the compiler's authoritative
	// raw↔lowered spans).
	registerTsdmlTemplateFeatures(context)
	// Parser errors (malformed values/expressions, unknown structure) are
	// tolerant by design; surface them as diagnostics so a typo is visible.
	registerTsdmlDiagnostics(context)
	const serverModule = vscode.Uri.joinPath(context.extensionUri, 'dist', 'server.js')
	const runOptions = { execArgv: <string[]>[] }
	const debugOptions = { execArgv: ['--nolazy', '--inspect=' + 6009] }
	const serverOptions: ServerOptions = {
		run: {
			module: serverModule.fsPath,
			transport: TransportKind.ipc,
			options: runOptions,
		},
		debug: {
			module: serverModule.fsPath,
			transport: TransportKind.ipc,
			options: debugOptions,
		},
	}
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ language: 'tsdml' }],
		initializationOptions: {
			typescript: {
				tsdk: (await getTsdk(context))!.tsdk,
			},
		},
	}
	client = new LanguageClient('tsdml-language-server', 'TSDML Language Server', serverOptions, clientOptions)
	await client.start()

	// Volar Labs (https://marketplace.visualstudio.com/items?itemName=johnsoncodehk.volarjs-labs)
	const labsInfo = createLabsInfo(serverProtocol)
	labsInfo.addLanguageClient(client)
	return labsInfo.extensionExports
}

export function deactivate(): Thenable<any> | undefined {
	return client?.stop()
}
