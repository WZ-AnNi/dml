/**
 * Fine-grained reactive bindings for the DOM renderer.
 *
 * This is the "Solid-style" runtime core: instead of re-rendering a whole tree
 * on state change, we bind each dynamic prop/child to a render-effect that
 * patches only that one binding. Static structure is created once.
 *
 * A "signal" here is any callable read (e.g. `count` from createSignal, or a
 * computed). We detect callables in props/children and subscribe to them.
 */

import { createEffect } from "@dml/reactivity"
import type { RendererElement, RendererNode } from "@dml/runtime-core"
import type { domRenderer } from "./dom.js"

type Renderer = typeof domRenderer

/** A callable read (signal/computed). */
type ReadFn<T = unknown> = () => T

function isReadFn(v: unknown): v is ReadFn {
  return typeof v === "function"
}

/**
 * Create an element with fine-grained reactive bindings.
 *
 * - props: a callable value is bound via `patch(el, key, prev, next)` inside a
 *   render-effect, so only that property updates.
 * - children: a callable child is rendered as a text node whose text updates
 *   on change (the common `{ count() }` case).
 *
 * Non-callable props/children are applied once, exactly like the static path.
 */
export function createReactiveElement(
  renderer: Renderer,
  tag: string,
  props?: Record<string, unknown> | null,
  children?: Array<RendererNode | string | ReadFn> | RendererNode | string | ReadFn,
): RendererElement {
  const el = renderer.createElement(tag)

  if (props) {
    for (const key in props) {
      const value = props[key]
      // event handlers (on*) are functions but NOT signals — apply statically
      const isEvent = key.startsWith("on")
      if (isReadFn(value) && !isEvent) {
        // reactive prop: patch on change
        let prev: unknown = value()
        renderer.patch(el, key, undefined, prev, false)
        createEffect(() => {
          const next = value()
          if (next !== prev) {
            renderer.patch(el, key, prev, next, false)
            prev = next
          }
        })
      } else {
        renderer.patch(el, key, undefined, value, false)
      }
    }
  }

  if (children != null) {
    const arr = Array.isArray(children) ? children : [children]
    for (const child of arr) {
      if (isReadFn(child)) {
        // reactive text child
        const textNode = renderer.createText(String(child()))
        renderer.mount(textNode, el)
        createEffect(() => {
          const next = String(child())
          renderer.patch(textNode, "textContent", undefined, next, false)
        })
      } else if (typeof child === "string") {
        const t = renderer.createText(child)
        renderer.mount(t, el)
      } else {
        renderer.mount(child, el)
      }
    }
  }

  return el
}
