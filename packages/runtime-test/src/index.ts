/**
 * @dml/runtime-test — public entry.
 *
 * A self-contained in-memory host node model plus its RendererOptions
 * implementation, plus the template kit bound to that host. Lets tests render
 * compiled `.tsdml` output into plain JS objects and assert on them, with no
 * DOM required.
 */

import { createRenderer, createTemplateKit } from "@dml/runtime-core"
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
    // DOM `insertBefore` MOVES a node that is already attached; keyed list
    // reuse relies on that (otherwise the node would appear twice).
    if (c.parent) {
      const old = c.parent.children.indexOf(c)
      if (old >= 0) c.parent.children.splice(old, 1)
    }
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
  /** Direct children, so a cloned subtree can be paired with its prototype. */
  children(node: RendererNode): RendererNode[] {
    return ((node as unknown as TestNode).children ?? []) as unknown as RendererNode[]
  },
  cloneNode(node: RendererNode, deep: boolean): RendererNode {
    const copy = (n: TestNode): TestNode => {
      const cloned: TestNode = {
        type: n.type,
        text: n.text,
        children: [],
        props: { ...n.props },
        events: { ...n.events },
      }
      if (deep) {
        // re-establish the parent links the test host navigates by
        cloned.children = (n.children ?? []).map((child) => {
          const childClone = copy(child)
          childClone.parent = cloned
          return childClone
        })
      }
      return cloned
    }
    return copy(node as unknown as TestNode) as unknown as RendererNode
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

/**
 * The primitives compiled `.tsdml` modules call when built for the test host.
 *
 * A project points the compiler at this module (`tsdml({ runtimeModule:
 * "@dml/runtime-test" })`) and its `.tsdml` sources keep using plain
 * components 鈥?`createCounter()` returns a `TestNode`, no renderer argument.
 */
export const { template, insert, setProp, setPropReactive, on, mount, each } =
  createTemplateKit(testRendererOptions)

/** Flatten a TestNode subtree into its text content (test assertions). */
export function toText(node: unknown): string {
  if (node == null) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(toText).join("")
  const n = node as TestNode
  if (n.type === "text") return n.text ?? ""
  return (n.children ?? []).map(toText).join("")
}

/** Depth-first search for the first TestNode matching `pred`. */
export function findNode(
  node: unknown,
  pred: (n: TestNode) => boolean,
): TestNode | undefined {
  if (node == null || typeof node !== "object") return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findNode(item, pred)
      if (hit) return hit
    }
    return undefined
  }
  const n = node as TestNode
  if (n.type !== "text" && pred(n)) return n
  for (const child of n.children ?? []) {
    const hit = findNode(child, pred)
    if (hit) return hit
  }
  return undefined
}
