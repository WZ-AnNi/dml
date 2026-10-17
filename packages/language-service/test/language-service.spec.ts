import { describe, expect, it } from "vitest"
import {
  TSDML_EXT,
  transformModule,
  transformSource,
  transformSourceDetailed,
} from "@tsdml/transform"
import { hitAtOffset, parseDts } from "../src/semantic.js"

/**
 * The TypeScript-server plugin itself lives in the editor package
 * (`editors/vscode-tsdml`, built on Volar's `createLanguageServicePlugin`) and
 * is covered by its integration suite (diag2307 / astsem / attrty / rootws).
 * This package owns the semantic model plus the transform contract exercised
 * here.
 */
describe("@tsdml/language-service", () => {
  it("keeps the surrounding TypeScript at stable offsets", () => {
    const src = `export const a = @{ div { "x" } }\nexport const b = 2\n`
    const detailed = transformSourceDetailed(src)
    // The generated text carries an injected prologue for the typed IR.
    expect(detailed.baseOffset).toBeGreaterThan(0)
    expect(detailed.code.startsWith("import type")).toBe(true)
    // Every mapping stays inside both coordinate systems, and the trailing gap
    // reaches the end of both texts exactly.
    for (const nodes of detailed.blockNodes) {
      for (const n of nodes) {
        expect(n.raw[0]).toBeLessThanOrEqual(n.raw[1])
        expect(n.lowered[0]).toBeLessThanOrEqual(n.lowered[1])
        expect(n.raw[1]).toBeLessThanOrEqual(src.length)
        expect(n.lowered[1]).toBeLessThanOrEqual(detailed.code.length)
      }
    }
    expect(transformSource(src)).not.toContain("@{")
  })

  it("lowers modules into the optimizing IR (no element factory calls)", () => {
    const src = `export const a = @{ div { @class: "x", { count() } } }`
    const out = transformModule(src, { runtimeModule: "@dml/runtime-test" })
    expect(out).toContain('from "@dml/runtime-test"')
    expect(out).toMatch(/const _\$t0 = _\$template\(/)
    expect(out).toMatch(/_?\$insert\(_n\$\[\d+\],\s*\(\)\s*=>\s*count\(\)\)/)
    expect(out).not.toMatch(/(?<![_$\w])e\(/)
  })

  it("exposes the tsdml extension constant", () => {
    expect(TSDML_EXT).toBe(".tsdml")
  })

  it("keeps the semantic entry points available", () => {
    expect(typeof hitAtOffset).toBe("function")
    expect(typeof parseDts).toBe("function")
  })
})
