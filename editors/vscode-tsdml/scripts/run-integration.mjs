// Launch real VS Code with the extension under development and run the
// integration suite against the tsdml-counter example workspace.
import { runTests } from '@vscode/test-electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const extRoot = pkgRoot // extension under test = this package (built dist/)
const suiteDir = path.join(pkgRoot, 'test', 'integration', 'suite')
// The integration specs model the repo-root "user scenario": opening the
// monorepo root in VS Code and working on examples/tsdml-counter (astsem,
// attrty, rootws all join(fsPath, 'examples', 'tsdml-counter', ...));
// diag2307 adapts to either root or the counter folder itself.
const workspace = process.env.ITEST_WORKSPACE || path.resolve(pkgRoot, '..', '..')

// 1) build the extension (client/server/plugin/@tsdml deploys)
console.log('[run-integration] building extension...')
execSync('node scripts/build.mjs', { cwd: pkgRoot, stdio: 'inherit' })

// 2) compile the integration suite TS → JS next to the sources (dynamic:
// every *.spec.ts in the suite dir; stale .js from removed specs are dropped)
const esbuild = path.join(pkgRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')
const specs = fs
  .readdirSync(suiteDir)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort()
for (const js of fs.readdirSync(suiteDir).filter((f) => f.endsWith('.spec.js'))) {
  if (!specs.includes(js.replace(/\.js$/, '.ts'))) fs.unlinkSync(path.join(suiteDir, js))
}
for (const entry of ['index.ts', ...specs]) {
  console.log(`[run-integration] compiling test suite ${entry}...`)
  execSync(
    `node "${esbuild}" "${path.join(suiteDir, entry)}" --bundle --format=cjs --platform=node --outfile="${path.join(suiteDir, entry.replace(/\.ts$/, '.js'))}" --external:vscode --external:mocha`,
    { stdio: 'inherit' },
  )
}

console.log('[run-integration] workspace:', workspace)
console.log('[run-integration] extension under test:', extRoot)
// Reuse the real user extensions dir so dml.vscode-dml (a hard dependency)
// is present; the dev copy of vscode-tsdml overrides the installed one.
const extensionsDir = process.env.ITEST_EXTDIR || path.join(process.env.USERPROFILE, '.vscode', 'extensions')
let failure = false
try {
  await runTests({
    vscodeExecutablePath: undefined,
    extensionDevelopmentPath: [extRoot],
    extensionTestsPath: path.join(suiteDir, 'index.js'),
    launchArgs: [
      workspace,
      '--extensions-dir', extensionsDir,
      '--disable-workspace-trust',
      '--skip-welcome',
      ...(process.env.ITEST_DISABLE_EXT ? process.env.ITEST_DISABLE_EXT.split(',').map((x) => ['--disable-extension', x.trim()]).flat() : []),
    ],
  })
} catch (err) {
  console.error('[run-integration] FAILED:', err)
  failure = true
}
process.exit(failure ? 1 : 0)
