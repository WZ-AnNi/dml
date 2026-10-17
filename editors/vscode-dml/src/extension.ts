/**
 * vscode-dml — VSCode client for the native Rust dml-lsp server.
 *
 * Spawns the `dml-lsp` binary (built from crates/dml-lsp) and connects it to
 * VSCode over stdio. The server reuses the same Rust parser as the compiler,
 * so diagnostics in the editor match what `@tsdml/compiler` reports.
 */

import * as vscode from "vscode"
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"
import * as path from "node:path"
import * as fs from "node:fs"

let client: LanguageClient | undefined

export function activate(context: vscode.ExtensionContext): void {
  const serverPath = resolveServerPath(context)
  if (!serverPath) {
    vscode.window.showErrorMessage(
      "dml-lsp binary not found. Build it with `cargo build -p dml-lsp` and set dml.lsp.path.",
    )
    return
  }

  const serverOptions: ServerOptions = {
    command: serverPath,
    transport: TransportKind.stdio,
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "dml", scheme: "file" },
      // `.tsdml` files are registered under the `typescript` language so the
      // built-in TypeScript language service (augmented by the
      // `@tsdml/language-service` server plugin) provides hints/completion.
      // Route just the `.tsdml` subset back to the native dml-lsp for DML
      // diagnostics that the TS service cannot produce.
      { language: "typescript", pattern: "**/*.tsdml", scheme: "file" },
    ],
    synchronize: {
      configurationSection: "dml",
    },
  }

  client = new LanguageClient(
    "dml-lsp",
    "DML Language Server",
    serverOptions,
    clientOptions,
  )

  client.start()
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined
  return client.stop()
}

/** Resolve the dml-lsp binary: config override, then bundled, then workspace. */
function resolveServerPath(context: vscode.ExtensionContext): string | undefined {
  const configured = vscode.workspace
    .getConfiguration("dml")
    .get<string>("lsp.path")
  if (configured && fs.existsSync(configured)) return configured

  // bundled binary shipped with the extension (if present)
  // Windows: `fs.existsSync` does not add `.exe`, so probe both names.
  const exe = process.platform === "win32" ? ".exe" : ""
  const bundled = path.join(context.extensionPath, "bin", `dml-lsp${exe}`)
  if (fs.existsSync(bundled)) return bundled

  // fall back to a sibling build in the monorepo
  const candidates = [
    path.join(context.extensionPath, "..", "..", "packages", "compiler-tsdml", "target", "debug", "dml-lsp.exe"),
    path.join(context.extensionPath, "..", "..", "packages", "compiler-tsdml", "target", "debug", "dml-lsp"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return undefined
}
