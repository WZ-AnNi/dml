/**
 * Parser diagnostics for `.tsdml` documents.
 *
 * The Rust compiler is deliberately tolerant: a malformed value still produces
 * a usable AST (so the editor keeps working mid-keystroke) and reports the
 * problem as a `ParseError` instead of throwing. Those errors were previously
 * only visible through the API/CLI, so a bad value in the editor looked like a
 * silently-ignored typo. This module publishes them as VS Code diagnostics.
 *
 * Diagnostics are computed in the extension host from the live document text
 * (so they track unsaved edits) using `collectDiagnostics` from
 * `@tsdml/transform` — the same parser the compiler uses, no second grammar.
 */

import * as vscode from 'vscode'
import { collectDiagnostics, type SourceDiagnostic } from '@tsdml/transform'

const EXT = '.tsdml'
const DEBOUNCE_MS = 150

/**
 * Byte offset → VS Code position.
 *
 * The compiler works in UTF-8 byte offsets while VS Code counts UTF-16 code
 * units, which diverge as soon as the template contains non-ASCII text (CJK,
 * emoji). Build the byte→unit map once per document version.
 */
function byteToUnitMap(text: string): number[] {
  const bytes = Buffer.byteLength(text, 'utf8')
  const map = new Array<number>(bytes + 1)
  let unit = 0
  let byte = 0
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8')
    for (let i = 0; i < size; i++) map[byte + i] = unit
    byte += size
    unit += char.length // 1 for BMP, 2 for surrogate pairs
  }
  map[bytes] = unit
  return map
}

function toRange(document: vscode.TextDocument, diagnostic: SourceDiagnostic): vscode.Range {
  const map = byteToUnitMap(document.getText())
  const start = map[Math.min(diagnostic.start, map.length - 1)] ?? 0
  const end = map[Math.min(diagnostic.end, map.length - 1)] ?? start
  return new vscode.Range(
    document.positionAt(start),
    document.positionAt(Math.max(start + 1, end)),
  )
}

function publish(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
): void {
  if (!document.uri.path.endsWith(EXT)) return
  const diagnostics = collectDiagnostics(document.getText()).map((d) => {
    const diag = new vscode.Diagnostic(
      toRange(document, d),
      d.message,
      vscode.DiagnosticSeverity.Error,
    )
    diag.source = 'tsdml'
    return diag
  })
  collection.set(document.uri, diagnostics)
}

/** Register the `.tsdml` parse-error diagnostics. */
export function registerTsdmlDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('tsdml')
  context.subscriptions.push(collection)

  const pending = new Map<string, NodeJS.Timeout>()
  const schedule = (document: vscode.TextDocument) => {
    if (!document.uri.path.endsWith(EXT)) return
    const key = document.uri.toString()
    const previous = pending.get(key)
    if (previous) clearTimeout(previous)
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key)
        publish(collection, document)
      }, DEBOUNCE_MS),
    )
  }

  // every already-open .tsdml document
  for (const document of vscode.workspace.textDocuments) publish(collection, document)

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => publish(collection, document)),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document)),
  )
}
