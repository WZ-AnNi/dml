// Post-build: copy the compiled .node from the napi crate dir to the package
// root so the TS facade's loader (`./index.node` fallback) and consumers find it.
import { cpSync, readdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const crateDir = join(pkgRoot, "crates", "napi-binding")
const distDir = join(pkgRoot, "dist")

const nodes = readdirSync(crateDir).filter(f => f.endsWith(".node"))
if (nodes.length === 0) {
  console.error("copy-node: no .node found in", crateDir)
  process.exit(1)
}
for (const f of nodes) {
  cpSync(join(crateDir, f), join(pkgRoot, f))
  console.log("copy-node: copied", f, "→ package root")
}
// also expose as index.node for the TS facade fallback loader
cpSync(join(crateDir, nodes[0]), join(pkgRoot, "index.node"))
console.log("copy-node: copied", nodes[0], "→ index.node")
// and into dist/ so the bundled facade (dist/index.mjs) can resolve ./index.node
cpSync(join(crateDir, nodes[0]), join(distDir, "index.node"))
console.log("copy-node: copied", nodes[0], "→ dist/index.node")