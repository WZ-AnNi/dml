import { describe, expect, it } from "vitest"
import { parse, type DmlElementJson } from "@tsdml/compiler"
import { findTemplateBlock } from "@tsdml/transform"
import {
  parseFile,
  hitAtOffset,
  tagCompletions,
  attrCompletions,
  hoverInfo,
  parseDts,
  type DtsModel,
} from "../src/semantic.js"

/** Minimal IntrinsicElements table for assertions. */
const DTS = `
declare namespace DML {
  interface HTMLAttributes<T> {
    id?: string;
    class?: string;
    onClick?: (e: Event) => void;
  }
  interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
    src?: string;
    alt?: string;
    width?: number;
    height?: number;
  }
  namespace IntrinsicElements {
    div: HTMLAttributes<HTMLDivElement>;
    section: HTMLAttributes<HTMLElement>;
    img: ImgHTMLAttributes<HTMLImageElement>;
    button: HTMLAttributes<HTMLButtonElement>;
  }
}
`

const model: DtsModel = parseDts(DTS)

const SRC = `export function createCounter(e: E) {
  const count = createSignal(0)
  return @{
    div {
      @class: "ticks",
      button {
        @onClick: increment,
        "Count is ",
        { count.read() }
      },
      img { @src: heroImg }
    }
  }
}
`

function parsed() {
  const out = parseFile(SRC, (dml) => JSON.parse(JSON.stringify(parse(dml))) as DmlElementJson, findTemplateBlock)
  return out
}

function offsetOf(needle: string): number {
  const i = SRC.indexOf(needle)
  if (i < 0) throw new Error(`needle not found: ${needle}`)
  return i
}

describe("semantic: parseFile → DmlNode forest with file spans", () => {
  const { blocks } = parsed()
  it("finds one block", () => {
    expect(blocks).toHaveLength(1)
    const [s, e] = blocks[0]!.span
    expect(SRC.slice(s, e)).toMatch(/^@\{/)
    expect(SRC[e - 1]).toBe("}")
  })
  it("routes caret on tag name", () => {
    const hit = hitAtOffset(blocks, offsetOf("div") + 1) // inside `div`
    expect(hit?.role).toBe("tag")
    expect(hit?.text).toBe("div")
  })
  it("routes caret on nested tag", () => {
    const hit = hitAtOffset(blocks, offsetOf("button") + 2)
    expect(hit?.role).toBe("tag")
    expect(hit?.text).toBe("button")
  })
  it("routes caret on attr name", () => {
    const hit = hitAtOffset(blocks, offsetOf("@class") + 2) // inside class
    expect(hit?.role).toBe("attrName")
    expect(hit?.text).toBe("class")
    expect(hit?.node.parentTag).toBe("div")
  })
  it("routes caret right after typed attr name", () => {
    const hit = hitAtOffset(blocks, offsetOf("@class") + 6) // after `class`
    expect(hit?.role).toBe("attrName")
  })
  it("routes caret inside expression", () => {
    const hit = hitAtOffset(blocks, offsetOf("count.read") + 5)
    expect(hit?.role).toBe("expr")
    expect(hit?.text).toContain("count")
  })
  it("routes caret inside text", () => {
    const hit = hitAtOffset(blocks, offsetOf("Count is") + 2)
    expect(hit?.role).toBe("text")
  })
})

describe("semantic: completions", () => {
  it("tag completion returns field kind, DML tags", () => {
    const items = tagCompletions(model, "di")
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.kind === "field")).toBe(true)
    expect(items.map((i) => i.label)).toContain("div")
  })
  it("tag completion full list includes img/section/button", () => {
    const items = tagCompletions(model, "")
    const labels = items.map((i) => i.label)
    for (const t of ["div", "section", "img", "button"]) expect(labels).toContain(t)
  })
  it("attr completion on div returns class/id/onClick (field kind)", () => {
    const items = attrCompletions(model, "div", "")
    expect(items.every((i) => i.kind === "field")).toBe(true)
    const labels = items.map((i) => i.label)
    expect(labels).toContain("class")
    expect(labels).toContain("id")
    expect(labels).toContain("onClick")
  })
  it("attr completion inherits base members (img has class via HTMLAttributes)", () => {
    const items = attrCompletions(model, "img", "")
    const labels = items.map((i) => i.label)
    expect(labels).toContain("src")
    expect(labels).toContain("class") // inherited
    expect(labels).toContain("alt")
  })
  it("attr completion on div does NOT offer img-only src", () => {
    const items = attrCompletions(model, "div", "")
    expect(items.map((i) => i.label)).not.toContain("src")
  })
  it("attr completion prefix filter works", () => {
    const items = attrCompletions(model, "img", "sr")
    expect(items.map((i) => i.label)).toEqual(["src"])
  })
})

describe("semantic: hover info", () => {
  const { blocks } = parsed()
  it("tag hover resolves type expr", () => {
    const hit = hitAtOffset(blocks, offsetOf("button") + 2)!
    const h = hoverInfo(hit, model)
    expect(h?.kind).toBe("tag")
    expect(h?.typeExpr).toContain("HTMLAttributes")
  })
  it("attr hover on inherited member finds declaration", () => {
    const hit = hitAtOffset(blocks, offsetOf("@class") + 2)!
    const h = hoverInfo(hit, model)
    expect(h?.kind).toBe("attrName")
    expect(h?.member?.sig).toContain("string")
  })
  it("attr hover on img-specific src", () => {
    const hit = hitAtOffset(blocks, offsetOf("@src") + 2)!
    const h = hoverInfo(hit, model)
    expect(h?.kind).toBe("attrName")
    expect(h?.member?.sig).toContain("string")
  })
})
