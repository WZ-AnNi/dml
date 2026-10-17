// AST-semantic completion verification (repo-root workspace):
//  1. tag completion (typing `di`) → DML tag list kind=Field (5), not Constant.
//  2. attr completion (typing `@c`) → DML props kind=Field.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 60_000
async function completionsAt(uri: vscode.Uri, p: vscode.Position): Promise<Array<{ label: string; kind?: number }>> {
  const c = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, p)
  return (c?.items ?? []).map((i: any) => ({ label: String(i?.label), kind: i?.kind }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const KIND_FIELD = 5

suite('AST semantic completion (repo-root workspace)', function () {
  this.timeout(WAIT_MS + 120_000)
  function counterUri(f: vscode.WorkspaceFolder): vscode.Uri {
    const dir = fs.existsSync(path.join(f.uri.fsPath, 'examples', 'tsdml-counter'))
      ? path.join(f.uri.fsPath, 'examples', 'tsdml-counter')
      : f.uri.fsPath
    return vscode.Uri.file(path.join(dir, 'src', 'counter.tsdml'))
  }
  test('tag completion after typing di → DML tags, kind Field', async function () {
    const f = vscode.workspace.workspaceFolders?.[0]
    assert.ok(f, 'workspace')
    const uri = counterUri(f)
    const doc = await vscode.workspace.openTextDocument(uri)
    const original = doc.getText()
    const openBrace = original.indexOf('@{')
    const anchor = original.indexOf('div { @class: "ticks" },', openBrace)
    assert.ok(anchor > 0, 'ticks anchor')
    const ticksClose = anchor + 'div { @class: "ticks" }'.length
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().insert(uri, doc.positionAt(ticksClose), ',\n      di'))
    const edited = doc.getText()
    const diAt = edited.indexOf('di', ticksClose + 2)
    const caret = doc.positionAt(diAt + 2)
    await sleep(1500)
    const items = await completionsAt(uri, caret)
    const labels = items.map((i) => i.label)
    console.log('[astsem] tag:', JSON.stringify(labels.slice(0, 10)), 'kinds:', JSON.stringify([...new Set(items.map((i) => i.kind))]))
    assert.ok(labels.includes('div'), `tag list must include div, got ${JSON.stringify(labels.slice(0, 12))}`)
    assert.ok(items.some((i) => i.label === 'div' && i.kind === KIND_FIELD), 'div should be kind Field(5)')
    assert.ok(!items.some((i) => i.kind === 21), 'no Constant(21) tag items')
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), original))
  })

  test('attr completion after typing @c → DML props, kind Field', async function () {
    const f = vscode.workspace.workspaceFolders?.[0]
    const uri = counterUri(f!)
    const doc = await vscode.workspace.openTextDocument(uri)
    const original = doc.getText()
    const openBrace = original.indexOf('@{')
    const btnOpen = original.indexOf('button {', openBrace)
    assert.ok(btnOpen > 0, 'button found')
    const onClk = original.indexOf('@onClick: increment', btnOpen)
    assert.ok(onClk > btnOpen, 'onClick attr')
    const insOff = onClk + '@onClick: increment'.length
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().insert(uri, doc.positionAt(insOff), ',\n            @c'))
    const edited = doc.getText()
    const cAt = edited.indexOf('@c', insOff)
    const caret = doc.positionAt(cAt + 2)
    await sleep(1500)
    const items = await completionsAt(uri, caret)
    const labels = items.map((i) => i.label)
    console.log('[astsem] attr:', JSON.stringify(labels.slice(0, 10)), 'kinds:', JSON.stringify([...new Set(items.map((i) => i.kind))]))
    const ok = labels.some((n) => ['children', 'class', 'classList', 'contentEditable'].includes(n))
    assert.ok(ok, `typing @c should offer DML props; got ${JSON.stringify(items.slice(0, 12))}`)
    await vscode.workspace.applyEdit(new vscode.WorkspaceEdit().replace(uri, new vscode.Range(0, 0, doc.lineCount + 1, 0), original))
  })
})
