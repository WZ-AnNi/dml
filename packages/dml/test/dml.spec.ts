import { describe, expect, it } from "vitest"
import { createSignal, createEffect, e, mount, createApp, domRenderer } from "../src/index.js"

describe("dml (umbrella)", () => {
  it("re-exports reactivity primitives", () => {
    expect(typeof createSignal).toBe("function")
    expect(typeof createEffect).toBe("function")
  })

  it("exposes the DOM renderer and element factory", () => {
    expect(domRenderer).toBeTruthy()
    expect(typeof e).toBe("function")
    expect(typeof mount).toBe("function")
    expect(typeof createApp).toBe("function")
  })

  it("createSignal returns { read, write, ref }", () => {
    const s = createSignal(10)
    expect(s.read()).toBe(10)
    s.write(20)
    expect(s.read()).toBe(20)
    expect(typeof s.ref).toBe("function")
  })
})
