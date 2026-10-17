// LSP smoke test for dml-lsp.exe: comment lines must produce NO semantic
// tokens, and token columns must be UTF-16 based (CJK-safe).
// Usage: node scripts/lsp-smoke.mjs <path-to-dml-lsp.exe> <file-to-test>
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [, , exePath, filePath] = process.argv
const text = readFileSync(filePath, 'utf8')

const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0)
const pending = new Map()
let nextId = 1

proc.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const idx = buf.indexOf('\r\n\r\n')
    if (idx < 0) return
    const header = buf.slice(0, idx).toString('utf8')
    const len = /Content-Length: (\d+)/i.exec(header)?.[1]
    if (!len) return
    const bodyStart = idx + 4
    if (buf.length < bodyStart + Number(len)) return
    const msg = JSON.parse(buf.slice(bodyStart, bodyStart + Number(len)).toString('utf8'))
    buf = buf.slice(bodyStart + Number(len))
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

function request(method, params) {
  const id = nextId++
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  return new Promise(res => pending.set(id, res))
}
function notify(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params })
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

const init = await request('initialize', {
  capabilities: {},
  rootUri: 'file:///D:/Data/HowToMarkAGoodXML',
})
if (!init.result?.capabilities?.semanticTokensProvider) {
  console.error('[smoke] FAIL: server did not declare semanticTokensProvider')
  process.exit(1)
}
notify('initialized', {})
notify('textDocument/didOpen', {
  textDocument: { uri: 'file:///test/dml.config.dml', languageId: 'dml', version: 1, text },
})

const res = await request('textDocument/semanticTokens/full', {
  textDocument: { uri: 'file:///test/dml.config.dml' },
})
const data = res.result?.data ?? []
const tokens = []
let line = 0
let col = 0
for (let i = 0; i < data.length; i += 5) {
  const [dl, dc, len, type] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
  line += dl
  col = dl === 0 ? col + dc : dc
  tokens.push({ line, col, len, type })
}

const lines = text.split(/\r?\n/)
const commentLines = new Set([0, 1, 2]) // the three // header lines
const offenders = tokens.filter(t => commentLines.has(t.line))
if (offenders.length > 0) {
  console.error('[smoke] FAIL: tokens on comment lines:', JSON.stringify(offenders))
  console.error('  lines:', offenders.map(t => lines[t.line].slice(t.col, t.col + t.len)).join(' | '))
  process.exit(1)
}

// UTF-16 sanity: line 2's quoted segment `"配置文件也是 DML 写的"` must not be
// tokenized at all (comment), and a token on a CJK-bearing line must not
// overshoot the line's UTF-16 length.
for (const t of tokens) {
  const u16len = lines[t.line].length // JS string indices ARE UTF-16 units
  if (t.col + t.len > u16len) {
    console.error(`[smoke] FAIL: token at ${t.line}:${t.col}+${t.len} exceeds line length ${u16len} (byte-offset bug)`)
    process.exit(1)
  }
}

console.log(`[smoke] PASS: ${tokens.length} tokens, 0 on comment lines, all within UTF-16 bounds`)
proc.kill()
process.exit(0)
