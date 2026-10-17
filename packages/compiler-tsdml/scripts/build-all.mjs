/**
 * Rebuild EVERY artifact that consumers load, from the Rust crates.
 *
 * One Rust change has two downstream binaries, and forgetting either one has
 * bitten this repo repeatedly:
 *
 *   dml-parser / dml-codegen / dml-ast
 *     ├── napi `.node`      → @tsdml/compiler      (TS server, Volar, vite)
 *     └── `dml-lsp.exe`     → vscode-dml extension  (editor diagnostics)
 *
 * A fix present in one and absent from the other shows up as "the compiler
 * agrees but the editor still reports the old error" — the failure that cost
 * several debugging rounds. This script builds both, in order, and reports the
 * exact destinations so a missing copy is visible rather than silent.
 *
 * Usage:
 *   node scripts/build-all.mjs             # napi + lsp, all consumers
 *   node scripts/build-all.mjs --napi      # napi only
 *   node scripts/build-all.mjs --lsp       # lsp only
 *   node scripts/build-all.mjs --check     # verify consumers are current, no build
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, mkdirSync, copyFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { platform, arch } from "node:process"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgRoot = dirname(scriptDir) // packages/compiler-tsdml
const repo = join(pkgRoot, "..", "..")

const args = process.argv.slice(2)
const onlyNapi = args.includes("--napi")
const onlyLsp = args.includes("--lsp")
const checkOnly = args.includes("--check")
const doNapi = !onlyLsp
const doLsp = !onlyNapi

const abi = platform === "win32" ? "msvc" : platform === "darwin" ? "darwin" : "gnu"
const triple = `${platform}-${arch}-${abi}`
const nodeName = `tsdml-compiler.${triple}.node`
const exeName = platform === "win32" ? "dml-lsp.exe" : "dml-lsp"

/** Hash a file, or null when it does not exist. */
function sha(p) {
  return existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null
}

/** Run a command, inheriting stdio; exit the process on failure.
 *
 *  Looks up `cmd` in the package's own `node_modules/.bin` first: `execFileSync`
 *  without a shell does not consult PATH the way a terminal does, so a bare
 *  `napi` would not resolve.
 */
function run(cmd, argv, cwd) {
  console.log(`\n$ ${cmd} ${argv.join(" ")}`)
  const local = join(cwd, "node_modules", ".bin", platform === "win32" ? `${cmd}.cmd` : cmd)
  const real = existsSync(local) ? local : cmd
  try {
    // A `.cmd` shim is a batch file; Node cannot spawn it directly on Windows.
    execFileSync(real, argv, {
      cwd,
      stdio: "inherit",
      shell: platform === "win32" && real.endsWith(".cmd"),
    })
  } catch {
    console.error(`\n[build-all] FAILED: ${cmd} ${argv.join(" ")}`)
    process.exit(1)
  }
}

/** Copy `src` to every `dest`, reporting each one. */
function ship(src, dests) {
  if (!existsSync(src)) {
    console.error(`[build-all] FATAL: ${src} not produced`)
    process.exit(1)
  }
  const srcHash = sha(src)
  for (const dest of dests) {
    mkdirSync(dirname(dest), { recursive: true })
    try {
      copyFileSync(src, dest)
      console.log(`  → ${dest.replace(repo + (platform === "win32" ? "\\" : "/"), "")}`)
    } catch (e) {
      if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
        console.error(`  ✗ LOCKED: ${dest}`)
        console.error(`    A running VS Code holds it. Close it and re-run, or the`)
        console.error(`    consumer keeps loading the STALE binary.`)
        process.exit(1)
      }
      throw e
    }
  }
  return srcHash
}

// ---------------------------------------------------------------------------
// consumers
// ---------------------------------------------------------------------------

/** Every on-disk location the @tsdml/compiler loader probes, per consumer. */
const nodeConsumers = [
  join(pkgRoot, nodeName),
  join(pkgRoot, "index.node"),
  join(pkgRoot, "dist", nodeName),
  join(pkgRoot, "dist", "index.node"),
  join(repo, "editors", "vscode-tsdml", "node_modules", "@tsdml", "compiler", nodeName),
  join(repo, "editors", "vscode-tsdml", "node_modules", "@tsdml", "compiler", "index.node"),
  join(repo, "editors", "vscode-tsdml", "node_modules", "@tsdml", "compiler", "dist", nodeName),
  join(repo, "editors", "vscode-tsdml", "node_modules", "@tsdml", "compiler", "dist", "index.node"),
]

const lspConsumers = [
  join(repo, "editors", "vscode-dml", "bin", exeName),
]

// ---------------------------------------------------------------------------
// --check: are the consumers current?
// ---------------------------------------------------------------------------
if (checkOnly) {
  let stale = 0
  if (doNapi) {
    const canonical = join(pkgRoot, "crates", "napi-binding", nodeName)
    const want = sha(canonical) ?? sha(join(pkgRoot, nodeName))
    console.log(`\n@tsdml/compiler (${nodeName})`)
    if (!want) {
      console.error(`  ✗ no built binary at ${canonical} — run build-all`)
      stale++
    } else {
      for (const p of nodeConsumers) {
        const ok = sha(p) === want
        console.log(`  ${ok ? "✓" : "✗ STALE"}  ${p}`)
        if (!ok) stale++
      }
    }
  }
  if (doLsp) {
    const release = join(pkgRoot, "target", "release", exeName)
    const want = sha(release)
    console.log(`\ndml-lsp (${exeName})`)
    if (!want) {
      console.error(`  ✗ no release binary at ${release} — run build-all`)
      stale++
    } else {
      for (const p of lspConsumers) {
        const ok = sha(p) === want
        console.log(`  ${ok ? "✓" : "✗ STALE"}  ${p}`)
        if (!ok) stale++
      }
    }
  }
  console.log(stale ? `\n[build-all] ${stale} STALE artifact(s)` : `\n[build-all] all consumers current`)
  process.exit(stale ? 1 : 0)
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

if (doNapi) {
  // napi-rs must drive the build (it emits the .node in the right shape).
  run("napi", ["build", "--platform", "--release", "--manifest-path", "crates/napi-binding/Cargo.toml"], pkgRoot)
  // tsdown wraps the JS loader; copy-node.mjs places it beside the loader.
  run("node", ["scripts/copy-node.mjs"], pkgRoot)
  const src = join(pkgRoot, "crates", "napi-binding", nodeName)
  console.log(`\n@tsdml/compiler → ${nodeConsumers.length} locations`)
  ship(src, nodeConsumers)
}

if (doLsp) {
  run("cargo", ["build", "-p", "dml-lsp", "--release"], pkgRoot)
  const src = join(pkgRoot, "target", "release", exeName)
  console.log(`\ndml-lsp → ${lspConsumers.length} location(s)`)
  ship(src, lspConsumers)
}

console.log("\n[build-all] done — both consumers now carry the same Rust code")
