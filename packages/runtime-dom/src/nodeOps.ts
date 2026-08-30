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

export const nodeOps = {
  createElement(tag: string): RendererElement {
    return DOMElement(document.createElement(tag))
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
