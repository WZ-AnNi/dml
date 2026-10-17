/**
 * Build the native `dml-lsp` server and place it in `bin/` so the extension
 * bundles it. Kept OUT of git (1 MB platform binary): rebuild with
 * `pnpm build:lsp` — same reason `target/` and `*.node` are ignored.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { platform } from "node:process"
import { fileURLToPath } from "node:url"

const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repo = join(extRoot, "..", "..")
const bin = join(extRoot, "bin")
const exe = platform === "win32" ? "dml-lsp.exe" : "dml-lsp"

const build = spawnSync("cargo", ["build", "-p", "dml-lsp", "--release"], {
  cwd: join(repo, "packages", "compiler-tsdml"),
  stdio: "inherit",
})
if (build.status !== 0) {
  console.error("[build:lsp] cargo failed")
  process.exit(build.status ?? 1)
}

const src = join(repo, "packages", "compiler-tsdml", "target", "release", exe)
if (!existsSync(src)) {
  console.error(`[build:lsp] FATAL: ${src} not produced`)
  process.exit(1)
}

mkdirSync(bin, { recursive: true })
// copyFileSync (not rename): the destination may be mapped by a running
// extension host, which Windows refuses to overwrite — see pack-vsix.mjs.
//
// A locked destination is the COMMON case while VS Code is open, and silently
// leaving the old binary there is how a fixed server keeps reporting the bug it
// just fixed. Say so loudly instead of dying with a raw EBUSY.
const dest = join(bin, exe)
const srcBytes = readFileSync(src)
const destBytes = existsSync(dest) ? readFileSync(dest) : null
if (destBytes && srcBytes.equals(destBytes)) {
  console.log(`[build:lsp] ${exe} already up to date in bin/`)
  process.exit(0)
}
try {
  copyFileSync(src, dest)
  console.log(`[build:lsp] ${exe} → bin/`)
} catch (e) {
  if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
    const pids = findHolders()
    console.error(`[build:lsp] ${exe} in bin/ is LOCKED by a running process${pids ? ` (${pids})` : ""}.`)
    console.error(`[build:lsp] Close VS Code (or the dml-lsp server) and re-run,`)
    console.error(`[build:lsp] otherwise the extension keeps loading the STALE server.`)
    process.exit(1)
  }
  throw e
}

/** PIDs holding the binary open, best-effort (Windows only, no hard dep). */
function findHolders() {
  if (platform !== "win32") return ""
  const out = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Process dml-lsp -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','`,
  ], { encoding: "utf8" })
  return (out.stdout ?? "").trim()
}
