/**
 * nodeOps — the DOM implementation of RendererOptions' node operations.
 *
 * This is the only place in the framework that calls `document.*` directly.
 * runtime-core never touches these.
 */

import type { RendererNode, RendererElement } from "@dml/runtime-core"

/** Cast DOM nodes into the host-node surface. */
export const DOMNode = (n: Node): RendererNode => n as unknown as RendererNode
export const DOMElement = (n: Element): RendererElement =>
  n as unknown as RendererElement

const SVG_NS = "http://www.w3.org/2000/svg"

export const nodeOps = {
  createElement(tag: string): RendererElement {
    return DOMElement(document.createElement(tag))
  },
  /** Namespace-aware creation: `svg` subtrees need `createElementNS`. */
  createElementNS(tag: string, isSVG: boolean): RendererElement {
    return DOMElement(
      isSVG ? document.createElementNS(SVG_NS, tag) : document.createElement(tag),
    )
  },
  /** Used by the template kit: one native deep copy per template instance. */
  cloneNode(node: RendererNode, deep: boolean): RendererNode {
    return DOMNode((node as unknown as Node).cloneNode(deep))
  },
  /** Direct children, so a cloned subtree can be paired with its prototype. */
  children(node: RendererNode): RendererNode[] {
    return Array.from((node as unknown as Node).childNodes, DOMNode)
  },
  isNode(value: unknown): boolean {
    return typeof Node !== "undefined" && value instanceof Node
  },
  createText(text: string): RendererNode {
    return DOMNode(document.createTextNode(text))
  },
  insert(
    child: RendererNode,
    parent: RendererElement,
    anchor?: RendererNode | null,
  ): void {
    ;(parent as unknown as Node).insertBefore(
      child as unknown as Node,
      (anchor as unknown as Node) ?? null,
    )
  },
  remove(child: RendererNode): void {
    const parent = (child as unknown as Node).parentNode
    if (parent) parent.removeChild(child as unknown as Node)
  },
  setText(node: RendererNode, text: string): void {
    ;(node as unknown as Text).nodeValue = text
  },
  setElementText(el: RendererElement, text: string): void {
    ;(el as unknown as Element).textContent = text
  },
  parentNode(node: RendererNode): RendererElement | null {
    const p = (node as unknown as Node).parentNode
    return p instanceof Element ? DOMElement(p) : null
  },
  nextSibling(node: RendererNode): RendererNode | null {
    const s = (node as unknown as Node).nextSibling
    return s ? DOMNode(s) : null
  },
}
