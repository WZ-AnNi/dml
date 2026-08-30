/**
 * createRenderer — enable a host-agnostic, fine-grained 0-VDOM renderer.
 *
 * Contrast with Vapor: Vapor's runtime-vapor calls the DOM directly. Here all
 * DOM access is behind the injected RendererOptions, so the same runtime-core
 * can drive DOM, canvas, a test host, etc.
 *
 * The renderer exposes primitive operations (create/mount/patch) rather than a
 * template engine: static structure is assembled once, and dynamic bindings
 * route through `patch` inside a render-effect (see @dml/reactivity).
 */

import { createNodeOps, insertBlock } from "./block.js"
import type {
  RendererElement,
  RendererNode,
  RendererOptions,
} from "./types.js"

export interface Renderer<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
> {
  /** Create an element (children joined). Static props applied now. */
  createElement(
    tag: string,
    props?: Record<string, unknown> | null,
    children?: Array<HostNode | string> | HostNode | string,
  ): HostElement
  /** Create a static text node. */
  createText(text: string): HostNode
  /** Mount a node into `parent` before `anchor` (append if null). */
  mount(
    node: HostNode,
    parent: HostElement,
    anchor?: HostNode | null,
  ): void
  /**
   * Fine-grained patch: apply one property/event/attr value. Used inside a
   * render-effect for dynamic bindings. `prev` lets the host skip no-ops.
   */
  patch(
    el: HostElement,
    key: string,
    prev: unknown,
    next: unknown,
    isSVG?: boolean,
  ): void
  /** Raw host operations (for advanced/block-level use). */
  nodeOps: ReturnType<typeof createNodeOps<HostNode, HostElement>>
}

export function createRenderer<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
>(
  options: RendererOptions<HostNode, HostElement>,
): Renderer<HostNode, HostElement> {
  const { createElement, createText, insert, patchProp } = options
  const nodeOps = createNodeOps<HostNode, HostElement>(options)

  const renderer: Renderer<HostNode, HostElement> = {
    createElement(tag, props, children) {
      const el = createElement(tag)
      if (props) {
        for (const key in props) {
          patchProp(el, key, undefined, props[key], false)
        }
      }
      if (children != null) {
        const arr = Array.isArray(children) ? children : [children]
        for (const child of arr) {
          if (typeof child === "string") {
            const t = createText(child)
            insert(t, el)
          } else {
            insert(child, el)
          }
        }
      }
      return el
    },
    createText(text) {
      return createText(text)
    },
    mount(node, parent, anchor) {
      insert(node, parent, anchor ?? null)
    },
    patch(el, key, prev, next, isSVG) {
      patchProp(el, key, prev, next, isSVG)
    },
    nodeOps: {
      insert: nodeOps.insert,
      remove: nodeOps.remove,
      removeChildren: nodeOps.removeChildren,
    },
  }

  // keep insertBlock available to callers that manage Blocks directly
  ;(renderer as unknown as { insertBlock: typeof insertBlock }).insertBlock =
    insertBlock

  return renderer
}
