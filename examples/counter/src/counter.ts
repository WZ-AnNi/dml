/**
 * Counter demo — exercises the fine-grained reactive runtime end to end.
 *
 * Uses the in-memory test host (no real DOM) so we can assert that:
 *   1. a signal child re-renders only its own text node on change
 *   2. an event handler (onClick) is wired and can mutate state
 *
 * This is the "Solid-style" 0-VDOM model: static structure is created once,
 * dynamic bindings patch in place.
 */

import { createSignal, createEffect } from "@dml/reactivity"
import { createTestRenderer } from "@dml/runtime-test"
import type { TestNode } from "@dml/runtime-test"

// A tiny reactive `e()` for the test host, mirroring dml's createReactiveElement
// but against the in-memory renderer.
function makeReactiveE(renderer: ReturnType<typeof createTestRenderer>) {
  return function e(
    tag: string,
    props?: Record<string, unknown> | null,
    children?: Array<TestNode | string | (() => unknown)> | TestNode | string | (() => unknown),
  ): TestNode {
    const el = renderer.createElement(tag)
    if (props) {
      for (const key in props) {
        const value = props[key]
        // event handlers (on*) are functions but NOT signals — apply statically
        const isEvent = key.startsWith("on")
        if (typeof value === "function" && !isEvent) {
          let prev: unknown = (value as () => unknown)()
          renderer.patch(el, key, undefined, prev)
          createEffect(() => {
            const next = (value as () => unknown)()
            if (next !== prev) {
              renderer.patch(el, key, prev, next)
              prev = next
            }
          })
        } else {
          renderer.patch(el, key, undefined, value)
        }
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children]
      for (const child of arr) {
        if (typeof child === "function") {
          const textNode = renderer.createText(String((child as () => unknown)()))
          renderer.mount(textNode, el)
          createEffect(() => {
            const next = String((child as () => unknown)())
            renderer.patch(textNode, "textContent", undefined, next)
          })
        } else if (typeof child === "string") {
          renderer.mount(renderer.createText(child), el)
        } else {
          renderer.mount(child, el)
        }
      }
    }
    return el
  }
}

export function createCounter() {
  const renderer = createTestRenderer()
  const e = makeReactiveE(renderer)

  const count = createSignal(0)
  const increment = () => count.write(count.read() + 1)

  const root = e(
    "div",
    { class: "counter" },
    [
      e("button", { onClick: increment }, "increment"),
      e("span", {}, count.read),
    ],
  )

  const container = renderer.createElement("div", null, [])
  renderer.mount(root, container)

  return {
    container: container as unknown as TestNode,
    increment,
    count,
  }
}
