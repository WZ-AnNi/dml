/**
 * @dml/runtime-test — public entry.
 *
 * A self-contained in-memory host node model plus its RendererOptions
 * implementation. Lets tests render runtime-core output into plain JS objects
 * and assert on them, with no DOM required.
 */

import { createRenderer } from "@dml/runtime-core"
import type { RendererElement, RendererNode, RendererOptions } from "@dml/runtime-core"

/** A test node is a plain, tree-shaped JS object. */
export interface TestNode {
  type: string | "text"
  text?: string
  parent?: TestNode | null
  children: TestNode[]
  props: Record<string, unknown>
  events: Record<string, ((...args: unknown[]) => unknown) | undefined>
  /** satisfies the host-node index-signature surface */
  [key: string]: unknown
}
export type TestElement = TestNode

export const testNodeOps = {
  createElement(type: string): RendererElement {
    return {
      type,
      children: [],
      props: {},
      events: {},
    } as unknown as RendererElement
  },
  createText(text: string): RendererNode {
    return { type: "text", text, children: [], props: {}, events: {} } as unknown as RendererNode
  },
  insert(
    child: RendererNode,
    parent: RendererElement,
    anchor?: RendererNode | null,
  ): void {
    const c = child as unknown as TestNode
    const p = parent as unknown as TestNode
    c.parent = p
    if (anchor) {
      const a = anchor as unknown as TestNode
      const idx = p.children.indexOf(a)
      if (idx >= 0) p.children.splice(idx, 0, c)
      else p.children.push(c)
    } else {
      p.children.push(c)
    }
  },
  remove(child: RendererNode): void {
    const c = child as unknown as TestNode
    const p = c.parent as unknown as TestNode
    if (p) {
      const i = p.children.indexOf(c)
      if (i >= 0) p.children.splice(i, 1)
      c.parent = null
    }
  },
  setText(node: RendererNode, text: string): void {
    ;(node as unknown as TestNode).text = text
  },
  setElementText(el: RendererElement, text: string): void {
    const e = el as unknown as TestNode
    e.children = [{ type: "text", text, children: [], props: {}, events: {} }]
  },
  parentNode(node: RendererNode): RendererElement | null {
    const p = (node as unknown as TestNode).parent
    return (p as RendererElement) ?? null
  },
  nextSibling(node: RendererNode): RendererNode | null {
    const n = node as unknown as TestNode
    const p = n.parent as TestNode | null
    if (!p) return null
    const i = p.children.indexOf(n)
    const next = p.children[i + 1]
    return (next as unknown as RendererNode) ?? null
  },
}

export const testPatchProp: RendererOptions["patchProp"] = (
  el,
  key,
  prev,
  next,
  isSVG,
) => {
  const e = el as unknown as TestNode
  if (key.startsWith("on")) {
    e.events[key] = next as (...args: unknown[]) => unknown
  } else if (next !== undefined && next !== null) {
    e.props[key] = next
  } else {
    delete e.props[key]
  }
}

export const testRendererOptions = {
  ...testNodeOps,
  patchProp: testPatchProp,
}

/** Renderer bound to the in-memory test host. */
export function createTestRenderer() {
  return createRenderer(testRendererOptions)
}
