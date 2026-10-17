// Post-build: copy the compiled .node to the package root + dist/.
//
// napi-rs `build` outputs `tsdml-compiler.<triple>.node` into
// `crates/napi-binding/`. A STALE copy from an older source may also sit at
// the package root — it is NOT trustworthy. This script always prefers the
// FRESH crate build and ships it under every name the loader checks:
//   dist/<triple>.node      (loader preferred)
//   dist/index.node         (loader fallback)
//   <triple>.node           (package root)
//   index.node              (package root, generic fallback)

import { cpSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { platform, arch } from "node:process"
import { fileURLToPath } from "node:url"

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(pkgRoot, "dist")

// napi-rs node-style triple for THIS platform.
const abi = platform === "win32" ? "msvc" : platform === "darwin" ? "darwin" : "gnu"
const triple = `${platform}-${arch}-${abi}`
const tripleName = `tsdml-compiler.${triple}.node`

const crateDir = join(pkgRoot, "crates", "napi-binding")
const releaseAtCrate = join(crateDir, tripleName)
const releaseAtRoot = join(pkgRoot, tripleName)
const source = existsSync(releaseAtCrate)
  ? releaseAtCrate
  : existsSync(releaseAtRoot)
    ? releaseAtRoot
    : null
if (!source) {
  console.error(`copy-node: no release binary for triple ${triple}`)
  console.error(`Run \`napi build --platform --release\` first.`)
  process.exit(1)
}
console.log(`copy-node: release source → ${source}`)

for (const dest of [
  join(pkgRoot, tripleName),
  join(pkgRoot, "index.node"),
  join(distDir, tripleName),
  join(distDir, "index.node"),
]) {
  if (source === dest) continue
  try {
    cpSync(source, dest, { force: true })
  } catch (e) {
    // A locked file (e.g. loaded by a running node) is fine as long as its
    // content is already the current build — warn and continue.
    console.warn(`copy-node: could not update ${dest} (${e.code ?? e}); ` +
      `if it is stale, close processes using it and re-run.`)
  }
}
console.log(`copy-node: shipped ${tripleName} to pkgRoot + dist/ (as <triple>.node and index.node)`)
