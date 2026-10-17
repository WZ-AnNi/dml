// USER-EXACT reproduction: workspace = MONOREPO ROOT (user opens the repo
// root folder, counter.tsdml lives in examples/tsdml-counter/src). Type-time
// completion must still fire for tags and attrs.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 150_000
const POLL_MS = 1_000
async function waitFor(pred: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    if (await pred()) return
    if (Date.now() > deadline) throw new Error(`TIMEOUT waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
async function completions(uri: vscode.Uri, p: vscode.Position): Promise<string[]> {
  const c = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', uri, p)
  return (c?.items ?? []).map((i) => String(i.label))
}

suite('repo-root workspace (user scenario)', function () {
  this.timeout(WAIT_MS + 60_000)
  test('type-time tag/attr completion in counter.tsdml under repo root', async function () {
    const f = vscode.workspace.workspaceFolders?.[0]
    assert.ok(f, 'workspace must be open')
    console.log('[rootws] workspace folder:', f.uri.fsPath)
    // counter.tsdml sits in examples/tsdml-counter/src (has its own tsconfig)
    const file = path.join(f.uri.fsPath, 'examples', 'tsdml-counter', 'src', 'counter.tsdml')
    assert.ok(require('fs').existsSync(file), `file missing: ${file}`)
    const uri = vscode.Uri.file(file)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, { preview: true })
    const text = doc.getText()
    const P = (i: number) => doc.positionAt(i)

    // TS-symbol hover on heroImg → tells us WHICH project serves this file
    // (its definition is the local const in the same file — works only when
    // the file is really in the TS program of some project).
    const hiAt = text.indexOf('heroImg')
    console.log('[rootws] hover heroImg:', JSON.stringify(await (async () => {
      const hs = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, P(hiAt + 4))
      return (hs ?? []).map((h) => h.contents.map(String)).flat().slice(0, 3)
    })()))

    // control — REAL template expr: `count.read()` inside `@{ ... }` (skip the
    // header comment which also mentions count.read)
    const openBrace = text.indexOf('@{')
    const readAt = text.indexOf('count.read', openBrace)
    assert.ok(readAt > openBrace, 'template count.read found')
    const readPos = P(readAt + 'count'.length)
    await waitFor(async () => {
      const c = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', uri, readPos)
      // TS symbol completion on `count.` → members; dictionary words mean the
      // file is NOT typed (no E context) — wait until real TS answers
      return (c?.items ?? []).some((i) => ['read', 'sample', 'toString'].includes(String(i.label)))
    }, 'TS member completion inside template expr')
    console.log('[rootws] control count.read comp:', JSON.stringify((await completions(uri, readPos)).slice(0, 10)))
    // project may still be settling (configured counter project is heavy);
    // give Volar a moment, then re-query the tag/attr positions.
    await new Promise((r) => setTimeout(r, 15_000))
    console.log('[rootws] (15s settle) re-hover heroImg:', JSON.stringify(await (async () => {
      const hs = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, P(hiAt + 4))
      return (hs ?? []).map((h) => h.contents.map(String)).flat().slice(0, 3)
    })()))

    // tag position — after `img` start (incomplete tag typed as "im" impossible in real file;
    // use existing tag string midpoint → same completion result as typing)
    const imgAt = text.indexOf('img', text.indexOf('@{')) // first img INSIDE template
    const tagPos = P(imgAt + 2) // mid "img"
    const tagComp = await completions(uri, tagPos)
    console.log('[rootws] TAG comp @img|:', JSON.stringify(tagComp.slice(0, 12)))
    const tagOk = tagComp.some((n) => ['div', 'span', 'img', 'section', 'a'].includes(n))
    console.log('[rootws] tag completion ok:', tagOk)
    assert.ok(tagOk, `repo-root workspace: DML tag completion MISSING, got ${JSON.stringify(tagComp.slice(0, 15))}`)

    // attr position — mid "@src"
    const srcAt = text.indexOf('@src')
    const attrPos = P(srcAt + 3) // after "src" → triggers attr list
    const attrComp = await completions(uri, attrPos)
    console.log('[rootws] ATTR comp @src|:', JSON.stringify(attrComp.slice(0, 12)))
    const attrOk = attrComp.some((n) => n.startsWith('src') || n.startsWith('alt') || n.startsWith('$ServerOnly'))
    console.log('[rootws] attr completion ok:', attrOk)
    assert.ok(attrOk, `repo-root workspace: DML attr completion MISSING, got ${JSON.stringify(attrComp.slice(0, 15))}`)
  })
})
