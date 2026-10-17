// Parser diagnostics: a malformed value in a `.tsdml` template must show up as
// an editor diagnostic (the compiler is tolerant, so nothing else reports it).
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 30_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForDiagnostics(
  uri: vscode.Uri,
  pred: (d: vscode.Diagnostic[]) => boolean,
  what: string,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const diags = vscode.languages.getDiagnostics(uri)
    if (pred(diags)) return diags
    if (Date.now() > deadline) {
      throw new Error(`TIMEOUT waiting for ${what}; got ${JSON.stringify(diags.map((d) => d.message))}`)
    }
    await sleep(300)
  }
}

suite('tsdml parse diagnostics', function () {
  this.timeout(WAIT_MS + 20_000)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsdml-diag-'))

  test('reports a malformed value and clears it once fixed', async function () {
    const file = path.join(dir, 'Broken.tsdml')
    fs.writeFileSync(
      file,
      ['export function Broken() {', '  return @{', '    div { @class: a + }', '  }', '}', ''].join('\n'),
    )
    const uri = vscode.Uri.file(file)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)

    // wait for OUR diagnostic (source: tsdml)
    const diags = await waitForDiagnostics(
      uri,
      (ds) => ds.some((d) => d.source === 'tsdml'),
      'a tsdml parse diagnostic',
    )
    const ours = diags.filter((d) => d.source === 'tsdml')
    console.log('[diag] got:', JSON.stringify(ours.map((d) => d.message)))
    assert.ok(
      ours.some((d) => d.message.includes('invalid value expression')),
      `expected an "invalid value expression" diagnostic, got ${JSON.stringify(ours.map((d) => d.message))}`,
    )
    // the rejected fragment must NOT reach TypeScript: one diagnostic, not a
    // cascade of TS1005/TS1136 syntax errors on the raw DML text
    assert.deepEqual(
      diags.filter((d) => d.source !== 'tsdml').map((d) => `${d.source}:${d.code}`),
      [],
      'no TypeScript syntax-error cascade for a bad fragment',
    )
    // the range must land on the offending value, not on line 0
    assert.ok(ours.some((d) => d.range.start.line === 2), `range should be on line 2: ${JSON.stringify(ours.map((d) => d.range.start))}`)

    // fix the value → the diagnostic disappears
    const ok = document.getText().replace('a +', 'count()')
    const edit = new vscode.WorkspaceEdit()
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), ok)
    await vscode.workspace.applyEdit(edit)
    await waitForDiagnostics(
      uri,
      (ds) => !ds.some((d) => d.source === 'tsdml'),
      'the diagnostic to clear',
    )
  })

  test('a valid template produces no tsdml diagnostic', async function () {
    const file = path.join(dir, 'Good.tsdml')
    fs.writeFileSync(
      file,
      [
        'export function Good() {',
        '  return @{',
        '    div {',
        '      @class: cond ? "a" : "b",',
        '      @style: { color: "red" },',
        '      @src: heroImg,',
        '      { count.read() }',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
    const uri = vscode.Uri.file(file)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)
    await sleep(1500)
    const ours = vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'tsdml')
    assert.equal(ours.length, 0, `expected no diagnostics, got ${JSON.stringify(ours.map((d) => d.message))}`)
  })

  test('maps byte offsets to positions for non-ASCII templates', async function () {
    const file = path.join(dir, 'Cjk.tsdml')
    fs.writeFileSync(
      file,
      ['export function Cjk() {', '  return @{', '    div { "中文文本", @class: a + }', '  }', '}', ''].join('\n'),
    )
    const uri = vscode.Uri.file(file)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)
    const diags = await waitForDiagnostics(
      uri,
      (ds) => ds.some((d) => d.source === 'tsdml'),
      'a tsdml diagnostic in a CJK template',
    )
    const ours = diags.find((d) => d.source === 'tsdml')!
    // the value `a +` sits after the CJK text on line 2; a naive byte→unit
    // mapping would overshoot the end of the line
    assert.equal(ours.range.start.line, 2)
    const line = document.lineAt(2).text
    assert.ok(
      ours.range.start.character <= line.length,
      `range ${ours.range.start.character} past line end ${line.length}`,
    )
    assert.ok(
      line.slice(ours.range.start.character).trimStart().startsWith('a +') ||
        line.slice(ours.range.start.character).startsWith('a +'),
      `range should point at the bad value: line=${JSON.stringify(line)} char=${ours.range.start.character}`,
    )
  })
})
