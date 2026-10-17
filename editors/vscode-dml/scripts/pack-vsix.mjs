/**
 * Pack (and optionally install) the vscode-dml extension as a `.vsix`.
 *
 * Two traps this script handles that a bare `vsce package` does not:
 *
 *   1. **A running VS Code maps `bin/dml-lsp.exe`**, so `npm run build` cannot
 *      refresh it and you silently keep the old server. VS Code installs each
 *      version into its own directory, so `--install` bumps to a
 *      `patch+1-dev.<timestamp>` version: the freshly built binary lands in a
 *      new folder and takes effect on the next window reload — no uninstall.
 *
 *   2. **`vsce` is invoked from the local devDependency**, never `npx`, because
 *      this machine's npm registry certificate is expired and `npx` would try
 *      to fetch it from the network.
 *
 * Usage:
 *   node scripts/pack-vsix.mjs                  # build a .vsix next to package.json
 *   node scripts/pack-vsix.mjs --install        # …and install it into VS Code
 *   node scripts/pack-vsix.mjs --version 9.9.9  # explicit version
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { platform } from "node:process"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, "..")
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"))

const args = process.argv.slice(2)
const install = args.includes("--install")
const explicit = args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined

/** `0.0.6` → `0.0.7-dev.202610171758` (greater than any shipped release). */
function devVersion(base) {
  const [major, minor, patch] = base.split(".").map((n) => Number.parseInt(n, 10))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)
  return `${major}.${minor}.${patch + 1}-dev.${stamp}`
}

const version = explicit ?? (install ? devVersion(pkg.version) : pkg.version)
const out = join(pkgRoot, `vscode-dml-${version}.vsix`)

// The bundled server must exist — it is the whole point of the extension.
const exe = platform === "win32" ? "dml-lsp.exe" : "dml-lsp"
if (!existsSync(join(pkgRoot, "bin", exe))) {
  console.error(`[vsix] FATAL: bin/${exe} missing — run \`npm run build:lsp\` first`)
  process.exit(1)
}

const vsce = join(pkgRoot, "node_modules", "@vscode", "vsce", "vsce")
if (!existsSync(vsce)) {
  console.error(`[vsix] FATAL: local vsce not found at ${vsce} (run \`npm install\`)`)
  process.exit(1)
}

console.log(`[vsix] packaging ${pkg.name}@${version} …`)
execFileSync(process.execPath, [vsce, "package", "--out", out, "--allow-missing-repository"], {
  cwd: pkgRoot,
  stdio: "inherit",
})
console.log(`[vsix] ${out}`)

if (!install) process.exit(0)

// `code` on PATH (the CLI shipped with VS Code). On Windows it is `code.cmd`,
// a batch file: Node's execFileSync cannot spawn that directly (EINVAL on
// Node 20+), so it must go through a shell.
const codeCmd = platform === "win32" ? "code.cmd" : "code"
console.log(`[vsix] installing via ${codeCmd} …`)
execFileSync(codeCmd, ["--install-extension", out, "--force"], {
  stdio: "inherit",
  shell: platform === "win32",
})
console.log("[vsix] installed — reload the VS Code window (Developer: Reload Window) to use it")
