import { describe, expect, it } from "vitest"
import { collectDiagnostics, findTemplateBlock, transformModule, transformSource, transformSourceDetailed } from "../src/index.js"

describe("@tsdml/transform", () => {
  it("finds a @{ } block and returns its inner DML", () => {
    const src = `const root = @{ div { "hi" } }`
    const block = findTemplateBlock(src, 0)
    expect(block).not.toBeNull()
    const [start, end, inner] = block!
    expect(inner).toBe(`div { "hi" }`)
    expect(src.slice(start, end)).toBe(`@{ div { "hi" } }`)
  })

  it("skips @{ inside comments and strings", () => {
    const src = `// @{ not a block }\nconst s = "@{ also not }"\nconst root = @{ span { "ok" } }`
    const block = findTemplateBlock(src, 0)
    expect(block).not.toBeNull()
    expect(block![2]).toBe(`span { "ok" }`)
  })

  it("lowers every block into e() calls, keeping TS intact", () => {
    const src = `
import { createSignal } from "dml"
export function Counter() {
  const count = createSignal(0)
  const increment = () => count.write(count.read() + 1)
  return @{
    div {
      @class: "counter",
      button { @onClick: increment, "increment" },
      span { { count.read() } }
    }
  }
}
`
    const out = transformSource(src)
    expect(out).toContain('import { createSignal } from "dml"')
    expect(out).toContain("const increment = () => count.write(count.read() + 1)")
    expect(out).toContain('e("div", { "class": "counter" }')
    expect(out).toContain('e("button", { "onClick": increment }, "increment")')
    expect(out).toContain('e("span", null, () => count.read())')
    expect(out).not.toContain("@{")
  })

  it("lowers @if / @for blocks and maps the loop binding to the generated parameter", () => {
    const src = `
export function List() {
  return @{
    ul {
      @for (tick of ticks.read()).key(tick.id) {
        li { @class: "tick", { tick.label } }
      },
      @if (empty.read()) { p { "nothing yet" } } @else { span { "ok" } }
    }
  }
}
`
    // The editor IR is a real TS expression, so the loop variable is a real
    // arrow parameter TS can type-check (and rename).
    const detailed = transformSourceDetailed(src)
    expect(detailed.code).toContain(
      'Array.from(ticks.read()).map((tick) => (tick.id, [ __dml_e("li", { "class": "tick" }, () => tick.label) ]))',
    )
    expect(detailed.code).toContain('(empty.read() ? [ __dml_e("p", null, "nothing yet") ] : [ __dml_e("span", null, "ok") ])')

    const loopVar = detailed.blockNodes.flat().filter((s) => s.role === "loopVar")
    expect(loopVar).toHaveLength(1)
    expect(src.slice(loopVar[0]!.raw[0], loopVar[0]!.raw[1])).toBe("tick")
    expect(detailed.code.slice(loopVar[0]!.lowered[0], loopVar[0]!.lowered[1])).toBe("tick")

    // The build IR declares the same binding in the arrow it emits.
    const built = transformModule(src, { runtimeModule: "@dml/runtime-dom" })
    expect(built).toContain("_$each(() => ticks.read(),(tick) => [")
    expect(built).toContain(",(tick) => tick.id)")
  })

  it("keeps a rejected fragment out of the editor IR (no TS error cascade)", () => {
    // `a +` is not a TS expression: the build must fail loudly, but the editor
    // IR must stay parseable — one diagnostic, not a syntax-error storm.
    const src = 'const root = @{ div { @class: "x", span { { a + } } } }'
    const detail = transformSourceDetailed(src)
    const error = collectDiagnostics(src).find((d) => d.message.includes("invalid expression"))
    expect(error).toBeDefined()
    // the raw text is gone from the generated code…
    expect(detail.code).not.toContain('a +')
    // …replaced by an expression of exactly the same length (offsets intact)
    const span = detail.blockNodes.flat().find((s) => src.slice(s.raw[0], s.raw[1]) === 'a +')!
    expect(detail.code.slice(span.lowered[0], span.lowered[1])).toBe('0  ')
    expect(detail.code.length).toBe(transformSourceDetailed(src).code.length)
  })

  it("rejects a constant key with the expression to write instead", () => {
    // `.key("id")` would give every item the same key: say what to write
    const src = `const root = @{ ul { @for (t of xs).key("id") { li { { t } } } } }`
    const diags = collectDiagnostics(src)
    expect(diags.some((d) => d.message.includes('.key("id")') && d.message.includes(".key(item.id)"))).toBe(true)
  })

  it("reports a directive used as an element attribute", () => {
    // `@if: cond` was the old compact form: tell the user the block form
    const src = `const root = @{ div { span { @if: cond, "x" } } }`
    expect(collectDiagnostics(src).some((d) => d.message.includes("control-flow directive"))).toBe(true)
  })
})
