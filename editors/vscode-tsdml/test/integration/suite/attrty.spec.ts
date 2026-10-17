// AST-semantic completion verification (repo-root workspace):
//  1. tag completion (typing `di`) → DML tag list with kind=Field (5),
//     NOT Constant (21) — the AST semantic layer answers, not string lowering.
//  2. attr completion (typing `@c`) → DML props with kind=Field.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 180_000
const POLL_MS = 1_000
async function waitFor(pred: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    if (await pred()) return
    if (Date.now() > deadline) throw new Error(`TIMEOUT waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
interface Item { label: string; kind?: number }
async function completionsAt(uri: vscode.Uri, p: vscode.Position): Promise<Item[]> {
  const c = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', uri, p)
  return (c?.items ?? []).map((i) => ({ label: String(i.label), kind: i.kind }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const KIND_FIELD = 5 // brick, TSX-style
const KIND_CONSTANT = 21 // string-literal (the OLD lowering behavior)

suite('AST semantic completion (repo-root workspace)', function () {
  this.timeout(WAIT_MS + 120_000)
  test('tag completion after typing di → DML tags, kind Field', async function () {
    const f = vscode.workspace.workspaceFolders?.[0]
    assert.ok(f, 'workspace')
    console.log('[astsem] workspace:', f.uri.fsPath)
    const file = path.join(f.uri.fsPath, 'examples', 'tsdml-counter', 'src', 'counter.tsdml')
    const uri = vscode.Uri.file(file)
    const doc = await vscode.workspace.openTextDocument(uri)
    const original = doc.getText()

    const openBrace = original.indexOf('@{')
    const readAt = original.indexOf('count.read', openBrace)
    const readPos = doc.positionAt(readAt + 'count'.length)
    await waitFor(async () => {
      const items = await completionsAt(uri, readPos)
      return items.some((i) => ['read', 'sample', 'toString'].includes(i.label))
    }, 'project real')
    console.log('[astsem] project alive')

    // Insert a fresh `di` element line after `div { @class: "ticks" }` —
    // exactly the mid-typing shape the old bug dropped.
    const anchor = original.indexOf('div { @class: "ticks" },', openBrace)
    assert.ok(anchor > 0, 'ticks anchor')
    const ticksClose = anchor + 'div { @class: "ticks" }'.length
    const aPos = doc.positionAt(ticksClose)
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().insert(uri, aPos, ',\n      di'))
    const edited = doc.getText()
    const diAt = edited.indexOf('di', ticksClose + 2)
    assert.ok(diAt > 0, 'typed di')
    const caret = doc.positionAt(diAt + 2)
    console.log('[astsem] TAG comp after typing di…')
    const items = await completionsAt(uri, caret)
    const labels = items.map((i) => i.label)
    console.log('[astsem] tag labels:', JSON.stringify(labels.slice(0, 14)))
    console.log('[astsem] tag kinds:', JSON.stringify([...new Set(items.map((i) => i.kind))]))

    assert.ok(labels.includes('div'), `tag list must include div, got ${JSON.stringify(labels.slice(0, 12))}`)
    const kinds = new Set(items.filter((i) => i.label.startsWith('d')).map((i) => i.kind))
    console.log('[astsem] d* kinds:', JSON.stringify([...kinds]))
    assert.ok(
      items.filter((i) => i.label.startsWith('d')).some((i) => i.kind === KIND_FIELD),
      `d-prefixed tag items should be kind Field(5), got kinds ${JSON.stringify([...kinds])}`,
    )
    assert.ok(
      !items.some((i) => i.kind === KIND_CONSTANT && labels.includes(i.label)),
      `no Constant(21) tag items — AST semantic layer answers; got ${JSON.stringify(items.slice(0, 10))}`,
    )

    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), original))
  })

  test('attr completion after typing @c → DML props, kind Field', async function () {
    const f = vscode.workspace.workspaceFolders?.[0]
    const file = path.join(f!.uri.fsPath, 'examples', 'tsdml-counter', 'src', 'counter.tsdml')
    const uri = vscode.Uri.file(file)
    const doc = await vscode.workspace.openTextDocument(uri)
    const original = doc.getText()
    const openBrace = original.indexOf('@{')
    const readAt = original.indexOf('count.read', openBrace)
    const readPos = doc.positionAt(readAt + 'count'.length)
    await waitFor(async () => {
      const items = await completionsAt(uri, readPos)
      return items.some((i) => ['read', 'sample', 'toString'].includes(i.label))
    }, 'project real')

    const btnOpen = original.indexOf('button {', openBrace)
    assert.ok(btnOpen > 0, 'button found')
    const onClk = original.indexOf('@onClick: increment', btnOpen)
    assert.ok(onClk > btnOpen, 'onClick attr found')
    const insOff = onClk + '@onClick: increment'.length
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().insert(uri, doc.positionAt(insOff), ',\n            @c'))
    const edited = doc.getText()
    const cAt = edited.indexOf('@c', insOff)
    assert.ok(cAt > insOff, 'typed @c')
    const caret = doc.positionAt(cAt + 2) // right after `c`
    console.log('[astsem] ATTR comp after typing @c…')
    const items = await completionsAt(uri, caret)
    const labels = items.map((i) => i.label)
    console.log('[astsem] attr labels:', JSON.stringify(labels.slice(0, 14)))
    console.log('[astsem] attr kinds:', JSON.stringify([...new Set(items.map((i) => i.kind))]))
    const ok = labels.some((n) => ['children', 'class', 'classList', 'contentEditable'].includes(n))
    assert.ok(ok, `typing @c should offer DML props; got ${JSON.stringify(items.slice(0, 14))}`)
    assert.ok(
      items.filter((i) => i.label.startsWith('c') || i.label.startsWith('a')).some((i) => i.kind === KIND_FIELD),
      `attr items should be kind Field(5); got kinds ${JSON.stringify([...new Set(items.map((i) => i.kind))])}`,
    )
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), original))
  })
})
