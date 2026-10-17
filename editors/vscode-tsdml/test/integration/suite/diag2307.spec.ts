// tsserver-plugin regression: `.tsdml` imports must resolve in tsserver —
//   main.ts      → ./counter.tsdml
//   counter.tsdml → ./components/*.tsdml   (components in their own files)
// Neither may show TS2307 ("cannot find module").
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 90_000
const SETTLE_MS = 12_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The example source dir, whether the workspace root is the repo or the example. */
function exampleFile(name: string): string {
  const f = vscode.workspace.workspaceFolders?.[0]
  assert.ok(f, 'workspace')
  const fs = require('fs')
  const direct = path.join(f.uri.fsPath, 'src', name)
  return fs.existsSync(direct)
    ? direct
    : path.join(f.uri.fsPath, 'examples', 'tsdml-counter', 'src', name)
}

/** Poll diagnostics until tsserver settles; returns the final list. */
async function settle(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  const t0 = Date.now()
  for (;;) {
    const diags = vscode.languages.getDiagnostics(uri)
    const code2307 = diags.filter((d) => String(d.code) === '2307')
    console.log(
      `[diag2307] poll ${Date.now() - t0}ms diags=${diags.length} code2307=${code2307.length}`,
    )
    if (Date.now() - t0 > SETTLE_MS) break
    if (Date.now() - t0 > WAIT_MS) break
    await sleep(1500)
  }
  return vscode.languages.getDiagnostics(uri)
}

suite('tsdml import resolves in tsserver', function () {
  this.timeout(WAIT_MS + 60_000)

  test('main.ts ./counter.tsdml has no TS2307', async function () {
    const fs = require('fs')
    const mainTs = exampleFile('main.ts')
    assert.ok(fs.existsSync(mainTs), `main.ts exists at ${mainTs}`)
    const uri = vscode.Uri.file(mainTs)
    await vscode.workspace.openTextDocument(uri)
    const final = await settle(uri)
    console.log(
      '[diag2307] main.ts diags:',
      JSON.stringify(final.map((d) => `${d.code}@${d.range.start.line}`)),
    )
    const still2307 = final.filter((d) => String(d.code) === '2307')
    assert.ok(
      still2307.length === 0,
      `TS2307 should be gone with tsdml-tsplugin; got ${JSON.stringify(final.slice(0, 5).map((d) => d.code))}`,
    )
  })

  test('counter.tsdml ./components/*.tsdml imports have no TS2307', async function () {
    const fs = require('fs')
    const counter = exampleFile('counter.tsdml')
    assert.ok(fs.existsSync(counter), `counter.tsdml exists at ${counter}`)
    const uri = vscode.Uri.file(counter)
    const doc = await vscode.workspace.openTextDocument(uri)
    // the example must actually exercise component imports, or this test lies
    assert.ok(
      doc.getText().includes('./components/Badge.tsdml'),
      'example imports a component from another .tsdml file',
    )
    const final = await settle(uri)
    console.log(
      '[diag2307] counter.tsdml diags:',
      JSON.stringify(final.map((d) => `${d.code}@${d.range.start.line}`)),
    )
    const bad = final.filter((d) => String(d.code) === '2307')
    assert.ok(
      bad.length === 0,
      `component imports must resolve; got ${JSON.stringify(bad.map((d) => d.message))}`,
    )
  })
})
