/**
 * @tsdml/vite — Vite plugin for TSDML.
 *
 * A `.tsdml` file is a TypeScript module with DML template blocks marked by
 * `@{ ... }` (the TSDML analogue of a JSX Fragment). This plugin lowers each
 * block with the native Rust compiler into the **optimizing runtime IR** —
 * the static structure hoisted to a module-scope template constant and dynamic
 * bindings addressing nodes by index — leaving the surrounding TS code
 * untouched, so TSDML compiles together with TS, seamlessly, inside Vite.
 *
 * Example:
 *   return @{
 *     div {
 *       @class: "counter",
 *       span { { count.read() } }
 *     }
 *   }
 * becomes:
 *   const _$t0 = _$template(["div",{"class":"counter"},[["span",null,[""]]]]);
 *   return (() => { const _n$ = _$t0(); _$insert(_n$[2],() => count.read()); return _n$[0] })()
 *
 * (No element factory calls, no props objects and no children arrays per
 * render — the host clones the hoisted shape per instance.)
 *
 * Vite does not recognise `.tsdml` as TypeScript, so rolldown would otherwise
 * parse the transformed output (which still contains `import type` and type
 * annotations) as plain JS. To make Vite apply its TS transform, every `.tsdml`
 * import is rewritten to a virtual id ending in `.ts`; the `load` hook reads the
 * real file, lowers the `@{ ... }` blocks, strips TS types via oxc, and hands
 * the result to Vite as a TypeScript module.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { transformWithOxc } from "vite"
import { TSDML_EXT, transformModule } from "@tsdml/transform"

/** Virtual id prefix; the trailing `.ts` makes Vite treat the module as TS. */
const VIRTUAL_PREFIX = "\0tsdml:"

/**
 * Rewrite relative imports (`./x`, `../x`) to absolute paths so they resolve
 * against the real `.tsdml` file's directory. A virtual module id has no real
 * directory, so Vite/rolldown would otherwise resolve `./assets/...` against
 * the wrong base (cwd in vitest, the virtual id's dir in the build) — this
 * makes both agree.
 */
function resolveRelativeImports(code: string, importerDir: string): string {
  return code.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (_m, pre: string, spec: string, post: string) =>
      pre + resolve(importerDir, spec).replace(/\\/g, "/") + post,
  )
}

export interface TsdmlViteOptions {
  /**
   * Host runtime module the compiled templates import their primitives from.
   * Defaults to `@dml/runtime-dom`; point it at `@dml/runtime-test` to build
   * the same `.tsdml` sources against the in-memory test host.
   */
  runtimeModule?: string
}

export function tsdml(options: TsdmlViteOptions = {}): {
  name: string
  enforce: "pre"
  config(config: { resolve?: { extensions?: string[] } }): { resolve: { extensions: string[] } }
  resolveId(source: string, importer?: string): string | null
  load(id: string): Promise<{ code: string; map: null } | null>
  transform(code: string, id: string): Promise<{ code: string; map: null } | null>
} {
  const runtimeModule = options.runtimeModule ?? "@dml/runtime-dom"
  const compile = (src: string) => transformModule(src, { runtimeModule })
  return {
    name: "tsdml",
    enforce: "pre",
    config(config) {
      // register .tsdml so bare imports resolve
      const exts = config.resolve?.extensions ?? [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]
      if (!exts.includes(TSDML_EXT)) exts.push(TSDML_EXT)
      return { resolve: { extensions: exts } }
    },
    resolveId(source, importer) {
      if (source.endsWith(TSDML_EXT)) {
        const base = importer ? dirname(importer) : process.cwd()
        const real = resolve(base, source)
        // virtual id ending in `.ts` so Vite applies its TypeScript transform
        return VIRTUAL_PREFIX + real + ".ts"
      }
      return null
    },
    async load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        const real = id.slice(VIRTUAL_PREFIX.length, -3) // strip the trailing ".ts"
        ;(this as unknown as { addWatchFile: (f: string) => void }).addWatchFile(real)
        const src = readFileSync(real, "utf-8")
        const lowered = compile(src)
        // resolve relative imports against the real file's directory
        const withAbsImports = resolveRelativeImports(lowered, dirname(real))
        // Lower the DML blocks, then strip TS types via oxc so the module is
        // valid JS that rolldown can parse regardless of how Vite classifies
        // the virtual id.
        const result = await transformWithOxc(withAbsImports, id, { lang: "ts" })
        return { code: result.code, map: null }
      }
      return null
    },
    async transform(code, id) {
      // fallback for files loaded directly by their real `.tsdml` path
      if (!id.endsWith(TSDML_EXT)) return null
      const lowered = compile(code)
      const result = await transformWithOxc(lowered, id, { lang: "ts" })
      return { code: result.code, map: null }
    },
  }
}

export default tsdml
