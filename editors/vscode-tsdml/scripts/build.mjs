/**
 * Build the vscode-tsdml extension:
 *   dist/client.js     — VS Code client (esbuild, external: vscode)
 *   dist/server.js     — Volar language server (bundles @volar/*, TS services,
 *                        and @tsdml/transform from source; @tsdml/compiler
 *                        stays external — native binding must live on disk)
 *   dist/selfcheck.cjs — assert-based self test for the virtual code mappings
 *
 * Also ships @tsdml/compiler (native napi binding) into node_modules/@tsdml/
 * so the vsix carries it — same layout the TS-server plugin used.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { platform, arch } from 'node:process'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = join(pkgRoot, '..', '..')
const transformSrc = join(repo, 'packages', 'transform', 'src', 'index.ts')
const compilerSrc = join(repo, 'packages', 'compiler-tsdml')
const lsSrc = join(repo, 'packages', 'language-service')

const watch = process.argv.includes('--watch')
const common = {
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node18',
	sourcemap: true,
	logLevel: 'warning',
	alias: { '@tsdml/transform': transformSrc },
	external: ['vscode', '@tsdml/compiler'],
}

async function one() {
	mkdirSync(join(pkgRoot, 'dist'), { recursive: true })
	await build({
		...common,
		entryPoints: {
			client: join(pkgRoot, 'src', 'extension.ts'),
			server: join(pkgRoot, 'src', 'server.ts'),
			selfcheck: join(pkgRoot, 'src', 'selfcheck.ts'),
			'patch-tsserver-tsdml': join(pkgRoot, 'src', 'patch-tsserver-tsdml.ts'),
		},
		outdir: join(pkgRoot, 'dist'),
	})
	console.log('[build] client.js / server.js / selfcheck.cjs done')

	// TypeScript-server plugin: a thin CJS module whose export IS the plugin
	// factory (`module.exports = init`), required by tsserver via
	// contributes.typescriptServerPlugins. tsserver probes the extension's own
	// node_modules for the plugin name, so it ships as node_modules/tsdml-tsplugin
	// (declared in devDependencies so `vsce`'s npm-list check stays green).
	// The heavy implementation is @tsdml/language-service which stays external
	// and resolves from the extension's own node_modules.
	const tsPluginPkg = join(pkgRoot, 'node_modules', 'tsdml-tsplugin')
	mkdirSync(tsPluginPkg, { recursive: true })
	await build({
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		logLevel: 'warning',
		entryPoints: { index: join(pkgRoot, 'src', 'tsPlugin.ts') },
		outdir: tsPluginPkg,
		external: ['@tsdml/language-service', '@tsdml/transform', '@tsdml/compiler', 'typescript', '@volar/typescript', '@volar/language-core', 'vscode-uri'],
	})
	writeFileSync(
		join(tsPluginPkg, 'package.json'),
		JSON.stringify({ name: 'tsdml-tsplugin', version: '0.0.4', main: 'index.js' }, null, 2),
	)
	console.log('[build] tsPlugin → node_modules/tsdml-tsplugin')

	// Ship @tsdml/compiler (native binding) into node_modules/@tsdml/.
	//
	// The loader (dist/index.mjs `loadBinding`) tries these in order:
	//   ./index.node, ../index.node, ./<triple>.node, ../<triple>.node
	// so ALL four on-disk locations must be refreshed. Missing one silently
	// keeps a stale compiler alive: the package's own dist works while the
	// extension loads an older binary (the "source OK, extension fails"
	// ghost). copy-node.mjs in compiler-tsdml writes the same four.
	const compilerDest = join(pkgRoot, 'node_modules', '@tsdml', 'compiler')
	cpSync(join(compilerSrc, 'dist'), join(compilerDest, 'dist'), { recursive: true })
	mkdirSync(join(compilerDest, 'dist'), { recursive: true })
	cpSync(join(compilerSrc, 'package.json'), join(compilerDest, 'package.json'))
	// scripts/ + crates/ carry no runtime code and only bloat the vsix.
	// (Nothing is copied from them here.)

	const abi = platform === 'win32' ? 'msvc' : platform === 'darwin' ? 'darwin' : 'gnu'
	const tripleName = `tsdml-compiler.${platform}-${arch}-${abi}.node`
	const fresh = join(compilerSrc, 'crates', 'napi-binding', tripleName)
	const root = join(compilerSrc, tripleName)
	const release = existsSync(fresh) ? fresh : root
	if (!existsSync(release)) {
		console.error(`[build] FATAL: no native binding at ${release}; run napi build in packages/compiler-tsdml`)
		process.exit(1)
	}
	for (const dest of [
		join(compilerDest, 'index.node'),
		join(compilerDest, tripleName),
		join(compilerDest, 'dist', 'index.node'),
		join(compilerDest, 'dist', tripleName),
	]) {
		cpSync(release, dest, { force: true })
	}
	console.log(`[build] shipped ${tripleName} → node_modules/@tsdml/compiler (pkg root + dist, both names)`)

	// Ship @tsdml/transform + @tsdml/language-service so the TS-server plugin
	// (external require above) resolves them from the extension's own
	// node_modules. Their dist folders are prebuilt by tsdown in each package.
	for (const sub of ['transform', 'language-service']) {
		const srcPkg = join(repo, 'packages', sub)
		const destPkg = join(pkgRoot, 'node_modules', '@tsdml', sub)
		mkdirSync(destPkg, { recursive: true })
		cpSync(join(srcPkg, 'dist'), join(destPkg, 'dist'), { recursive: true })
		cpSync(join(srcPkg, 'package.json'), join(destPkg, 'package.json'))
		console.log(`[build] shipped @tsdml/${sub} → node_modules/@tsdml/${sub}`)
	}
}

if (watch) {
	const ctx = await build({
		...common,
		entryPoints: {
			client: join(pkgRoot, 'src', 'extension.ts'),
			server: join(pkgRoot, 'src', 'server.ts'),
		},
		outdir: join(pkgRoot, 'dist'),
	})
	await ctx.watch()
	console.log('[build] watching…')
} else {
	await one()
}
