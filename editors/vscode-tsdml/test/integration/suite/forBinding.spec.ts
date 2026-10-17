// The `@for` loop binding must be a REAL TypeScript binding in the editor:
//   * `tick` resolves inside the block (no TS2304 "cannot find name"),
//   * it is typed as the iterable's element, so a wrong property is TS2339.
// That is what makes `@for (tick of ticks.read()).key("id") { … tick.label … }`
// type-checked rather than merely tolerated.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const WAIT_MS = 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCE = [
  'type Tick = { id: number; label: string }',
  'declare const ticks: { read(): Tick[] }',
  '',
  'export function List() {',
  '  return @{',
  '    ul {',
  '      @for (tick of ticks.read()).key("id") {',
  '        li { { tick.label } }',
  '        li { { tick.nope } }',
  '      }',
  '    }',
  '  }',
  '}',
  '',
].join('\n')

async function settle(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
  const t0 = Date.now()
  let diags: vscode.Diagnostic[] = []
  for (;;) {
    diags = vscode.languages.getDiagnostics(uri)
    if (diags.some((d) => String(d.code) === '2339') || Date.now() - t0 > WAIT_MS) break
    await sleep(1000)
  }
  return diags
}

suite('tsdml @for binding is a typed TS binding', function () {
  this.timeout(WAIT_MS + 30_000)

  test('loop variable resolves and is typed', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsdml-for-'))
    const file = path.join(dir, 'List.tsdml')
    fs.writeFileSync(file, SOURCE)
    const uri = vscode.Uri.file(file)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)

    const diags = await settle(uri)
    const codes = diags.map((d) => `${d.code}@${d.range.start.line + 1}:${d.range.start.character + 1}`)
    console.log('[for-binding] diags:', JSON.stringify(codes))

    // the loop variable is in scope everywhere in the block
    const unknown = diags.filter((d) => String(d.code) === '2304')
    assert.equal(unknown.length, 0, `TS2304 for the loop binding: ${JSON.stringify(codes)}`)

    // and it carries the element type of the iterable
    const wrongProp = diags.filter((d) => String(d.code) === '2339')
    assert.equal(wrongProp.length, 1, `expected exactly one TS2339: ${JSON.stringify(codes)}`)
    // the error must land on `tick.nope` (line 9), not on `tick.label`
    assert.equal(wrongProp[0]!.range.start.line, 8, `line: ${wrongProp[0]!.range.start.line + 1}`)
    assert.ok(
      /nope/.test(wrongProp[0]!.message),
      `message should name the bad property: ${wrongProp[0]!.message}`,
    )
  })
})
