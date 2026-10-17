import { describe, expect, it } from "vitest"
import { createRenderer } from "../src/index.js"
import type { RendererElement, RendererNode } from "../src/index.js"

// Minimal in-memory host so runtime-core can be exercised without a DOM.
interface TestEl extends RendererElement {
  type: string
  props: Record<string, unknown>
  children: TestNode[]
}
type TestNode = TestEl | { type: "text"; text: string }

function makeHost() {
  const createElement = (tag: string): TestEl => ({
    type: tag,
    props: {},
    children: [],
  })
  const createText = (text: string): TestNode => ({ type: "text", text })
  const insert = (child: TestNode, parent: TestEl, anchor: TestNode | null = null) => {
    if (anchor == null) {
      parent.children.push(child)
    } else {
      const i = parent.children.indexOf(anchor)
      parent.children.splice(i < 0 ? parent.children.length : i, 0, child)
    }
  }
  const patchProp = (el: TestEl, key: string, _prev: unknown, next: unknown) => {
    el.props[key] = next
  }
  return { createElement, createText, insert, patchProp }
}

describe("@dml/runtime-core", () => {
  it("createRenderer builds a host-agnostic renderer", () => {
    const host = makeHost()
    const renderer = createRenderer<TestNode, TestEl>(host)
    expect(typeof renderer.createElement).toBe("function")
    expect(typeof renderer.mount).toBe("function")
    expect(typeof renderer.patch).toBe("function")
  })

  it("createElement applies static props and mounts string children", () => {
    const host = makeHost()
    const renderer = createRenderer<TestNode, TestEl>(host)
    const el = renderer.createElement("div", { class: "box" }, ["hello", "world"])
    expect(el.type).toBe("div")
    expect(el.props["class"]).toBe("box")
    expect(el.children.map(c => (c as { text: string }).text)).toEqual(["hello", "world"])
  })

  it("patch routes through the injected patchProp", () => {
    const host = makeHost()
    const renderer = createRenderer<TestNode, TestEl>(host)
    const el = renderer.createElement("span")
    renderer.patch(el, "textContent", undefined, "42")
    expect(el.props["textContent"]).toBe("42")
  })
})
