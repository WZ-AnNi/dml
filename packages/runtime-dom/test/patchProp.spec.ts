import { describe, expect, it, beforeAll } from "vitest"
import { patchProp } from "../src/patchProp.js"

// happy-dom provides a global document; ensure it's present
beforeAll(() => {
  if (typeof document === "undefined") {
    throw new Error("happy-dom environment required")
  }
})

describe("@dml/runtime-dom patchProp", () => {
  it("sets class via className", () => {
    const el = document.createElement("div")
    patchProp(el as never, "class", undefined, "btn primary")
    expect(el.className).toBe("btn primary")
  })

  it("removes class when null", () => {
    const el = document.createElement("div")
    el.className = "btn"
    patchProp(el as never, "class", "btn", null)
    expect(el.hasAttribute("class")).toBe(false)
  })

  it("sets style from a string", () => {
    const el = document.createElement("div")
    patchProp(el as never, "style", undefined, "color: red")
    expect(el.getAttribute("style")).toContain("color")
  })

  it("sets style from an object", () => {
    const el = document.createElement("div")
    patchProp(el as never, "style", undefined, { color: "red", fontSize: "12px" })
    expect((el as HTMLElement).style.color).toBe("red")
    expect((el as HTMLElement).style.fontSize).toBe("12px")
  })

  it("wires and updates an event listener", () => {
    const el = document.createElement("button")
    let clicks = 0
    const handler = () => clicks++
    patchProp(el as never, "onClick", undefined, handler)
    el.dispatchEvent(new Event("click"))
    expect(clicks).toBe(1)
    // update handler without re-adding listener
    let clicks2 = 0
    const handler2 = () => clicks2++
    patchProp(el as never, "onClick", handler, handler2)
    el.dispatchEvent(new Event("click"))
    expect(clicks).toBe(1) // old handler not called
    expect(clicks2).toBe(1) // new handler called
  })

  it("removes an event listener when handler is null", () => {
    const el = document.createElement("button")
    let clicks = 0
    const handler = () => clicks++
    patchProp(el as never, "onClick", undefined, handler)
    patchProp(el as never, "onClick", handler, null)
    el.dispatchEvent(new Event("click"))
    expect(clicks).toBe(0)
  })

  it("sets a DOM property when it exists", () => {
    const el = document.createElement("input")
    patchProp(el as never, "value", undefined, "hello")
    expect((el as HTMLInputElement).value).toBe("hello")
  })

  it("falls back to attribute for unknown keys", () => {
    const el = document.createElement("div")
    patchProp(el as never, "data-x", undefined, "42")
    expect(el.getAttribute("data-x")).toBe("42")
  })
})
