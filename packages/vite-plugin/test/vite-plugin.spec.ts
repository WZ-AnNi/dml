import { describe, expect, it } from "vitest"
import { tsdml } from "../src/index.js"

describe("@tsdml/vite", () => {
  it("lowers a @{ } block into the optimizing IR, keeping TS intact", async () => {
    const plugin = tsdml()
    const code = `
import { createSignal } from "dml"

export function Counter() {
  const count = createSignal(0)
  const increment = () => count.write(count.read() + 1)

  return @{
    div {
      @class: "counter",
      button {
        @onClick: increment,
        "increment"
      },
      span {
        { count() }
      }
    }
  }
}
`
    const result = await plugin.transform(code, "/src/Counter.tsdml")
    expect(result).not.toBeNull()
    const out = result!.code
    // TS logic preserved verbatim
    expect(out).toContain('import { createSignal } from "dml"')
    expect(out).toContain("const increment = () => count.write(count.read() + 1)")
    // the static structure is hoisted to ONE template constant, with the
    // literal props inside the shape (no per-render props objects).
    // (Vite's oxc pass re-prints the generated code, so match format-agnostic.)
    expect(out).toMatch(/const _\$t0 = _\$template\(/)
    expect(out).toMatch(/["']class["']\s*:\s*["']counter["']/)
    // the runtime import comes from the host module, aliased to reserved names
    expect(out).toMatch(/from\s*["']@dml\/runtime-dom["']/)
    // dynamic bindings: an event and one reactive text insertion
    expect(out).toMatch(/_?\$on\(_n\$\s*\[\s*\d+\s*\]\s*,\s*["']onClick["']\s*,\s*increment\)/)
    expect(out).toMatch(/_?\$insert\(_n\$\s*\[\s*\d+\s*\]\s*,\s*\(\)\s*=>\s*count\(\)\)/)
    // no element factory calls, no leftover @{ marker
    expect(out).not.toMatch(/(?<![_$\w])e\(/)
    expect(out).not.toContain("@{")
  })

  it("builds against an alternative host runtime when asked", async () => {
    const plugin = tsdml({ runtimeModule: "@dml/runtime-test" })
    const out = (await plugin.transform(`const a = @{ div { "x" } }`, "/x.tsdml"))!.code
    expect(out).toContain('from "@dml/runtime-test"')
  })

  it("ignores non-tsdml files", async () => {
    const plugin = tsdml()
    const result = await plugin.transform("const x = 1", "/src/foo.ts")
    expect(result).toBeNull()
  })

  it("handles multiple template blocks", async () => {
    const plugin = tsdml()
    const code = `
const a = @{ div { "one" } }
const b = @{ span { "two" } }
`
    const out = (await plugin.transform(code, "/x.tsdml"))!.code
    expect(out).toMatch(/const _\$t0 = _\$template\(/)
    expect(out).toMatch(/const _\$t1 = _\$template\(/)
    expect(out).toContain('"one"')
    expect(out).toContain('"two"')
    expect(out).toContain("_$t0()[0]")
    expect(out).toContain("_$t1()[0]")
    // the helper import is emitted once, not per block
    expect(out.match(/_?\$template as/g)?.length ?? (out.match(/template as _\$template/g)?.length ?? 0)).toBe(1)
  })
})
