/**
 * Bundle the TSDML language-service plugin into this extension's
 * `node_modules/@tsdml/*` so the TS server can load it from the extension
 * directory (its `--pluginProbeLocations`) — no project-local installs, no
 * workspace config.
 *
 * Layout produced (shipped in the VSIX):
 *   node_modules/@tsdml/language-service/{package.json, dist/index.cjs}
 *   node_modules/@tsdml/compiler/{package.json, dist/** , *.node}
 *
 * The plugin bundle inlines `@tsdml/transform` and keeps `@tsdml/compiler`
 * external (it is a native napi `.node` binary that must live on disk).
 *
 * IMPORTANT: napi-rs ships two binaries — a generic `index.node` (often a
 * debug build, ~440 KB) and the platform-triple `tsdml-compiler.<triple>.node`
 * (the real release build, ~1.2 MB). The compiler's loader prefers the
 * triple binary. We explicitly discover the release triple binary here and
 * guarantee it ends up at BOTH `dist/<triple>.node` AND `dist/index.node`
 * in the extension — so the loader finds it regardless of the source
 * `dist/index.node` being locked by another process.
 */
import { build } from "esbuild"
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { platform, arch } from "node:process"
import { fileURLToPath } from "node:url"

const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repo = join(extRoot, "..", "..")
const nm = join(extRoot, "node_modules")

const lsPkg = join(nm, "@tsdml", "language-service")
const compilerPkg = join(nm, "@tsdml", "compiler")

console.log("[bundle:plugin] bundling @tsdml/language-service for the extension…")
mkdirSync(join(lsPkg, "dist"), { recursive: true })
await build({
  entryPoints: [join(repo, "packages/language-service/dist/index.cjs")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["typescript", "@tsdml/compiler"],
  outfile: join(lsPkg, "dist/index.cjs"),
  logLevel: "warning",
})

writeFileSync(
  join(lsPkg, "package.json"),
  JSON.stringify(
    {
      name: "@tsdml/language-service",
      version: "0.0.4",
      description:
        "TSDML TypeScript language-service plugin (bundled for the vscode-dml extension).",
      main: "dist/index.cjs",
      type: "commonjs",
    },
    null,
    2,
  ) + "\n",
)

console.log("[bundle:plugin] copying @tsdml/compiler (native binding)…")
rmSync(compilerPkg, { recursive: true, force: true })
mkdirSync(compilerPkg, { recursive: true })
const compilerSrc = join(repo, "packages/compiler-tsdml")
cpSync(join(compilerSrc, "dist"), join(compilerPkg, "dist"), { recursive: true })
copyFileSync(join(compilerSrc, "package.json"), join(compilerPkg, "package.json"))

// Discover the release triple binary at the compiler package root.
// The `napi.outputDir: "."` config places `tsdml-compiler.<triple>.node`
// at the package root. Find it dynamically (don't hardcode the triple).
const abi = platform === "win32" ? "msvc" : platform === "darwin" ? "darwin" : "gnu"
const expectedTriple = `${platform}-${arch}-${abi}`
const expectedName = `tsdml-compiler.${expectedTriple}.node`
const releaseSrc = join(compilerSrc, expectedName)
if (!existsSync(releaseSrc)) {
  console.error(`[bundle:plugin] FATAL: expected release binary at ${releaseSrc}`)
  console.error(`[bundle:plugin] Run \`napi build --platform --release\` in packages/compiler-tsdml first.`)
  process.exit(1)
}

// Ship it everywhere the loader might look. We COPY (not cpSync -r) so a
// locked source file doesn't block us; we write fresh files into the ext.
mkdirSync(join(compilerPkg, "dist"), { recursive: true })
copyFileSync(releaseSrc, join(compilerPkg, expectedName))
copyFileSync(releaseSrc, join(compilerPkg, "dist", expectedName))
copyFileSync(releaseSrc, join(compilerPkg, "dist", "index.node")) // loader fallback
console.log(`[bundle:plugin] shipped release binary (${expectedName}) to dist/<triple>.node + dist/index.node`)

// Also ship any other triple binaries that happen to live at the root
// (harmless; lets the loader resolve on the right platform even if the user
// copies the vsix to a different-OS box).
for (const f of readdirSync(compilerSrc)) {
  if (!f.startsWith("tsdml-compiler.") || !f.endsWith(".node")) continue
  if (f === expectedName) continue
  copyFileSync(join(compilerSrc, f), join(compilerPkg, f))
}

console.log("[bundle:plugin] done:", join(lsPkg, "dist/index.cjs"))