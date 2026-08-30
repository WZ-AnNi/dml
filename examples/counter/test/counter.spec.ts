import { describe, expect, it } from "vitest"
import { createCounter } from "../src/counter.js"
import type { TestNode } from "@dml/runtime-test"

function findButton(node: TestNode): TestNode {
  return node.children.find(c => c.type === "button") as TestNode
}
function findSpan(node: TestNode): TestNode {
  return node.children.find(c => c.type === "span") as TestNode
}

describe("@dml/example-counter (fine-grained reactive runtime)", () => {
  it("renders initial state", () => {
    const { container } = createCounter()
    const div = container.children[0] as TestNode
    expect(div.type).toBe("div")
    expect(div.props["class"]).toBe("counter")
    expect(findButton(div).events["onClick"]).toBeTypeOf("function")
    // span text node shows 0
    const span = findSpan(div)
    expect(span.children[0]!.text).toBe("0")
  })

  it("re-renders only the bound text node when the signal changes", () => {
    const { container, increment } = createCounter()
    const div = container.children[0] as TestNode
    const span = findSpan(div)
    const textNode = span.children[0] as TestNode

    increment() // count 0 -> 1
    expect(textNode.props["textContent"]).toBe("1")

    increment() // 1 -> 2
    expect(textNode.props["textContent"]).toBe("2")

    // the span still has exactly one child (no re-mount, in-place patch)
    expect(span.children.length).toBe(1)
  })

  it("wires the onClick handler to mutate state", () => {
    const { container, increment } = createCounter()
    const div = container.children[0] as TestNode
    const button = findButton(div)
    const span = findSpan(div)

    const handler = button.events["onClick"] as () => void
    handler()
    expect(span.children[0]!.props["textContent"]).toBe("1")
    expect(increment).toBeTypeOf("function")
  })
})
