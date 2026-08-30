/**
 * Host-agnostic renderer options.
 *
 * This is the atomization boundary between runtime-core (pure logic) and the
 * concrete host (DOM / test / canvas / ...). Anything a host must provide to
 * render is declared here; runtime-core never touches the DOM directly.
 *
 * Modelled after Vue's `createRenderer(options)` / Vapor's `dom/*`, but
 * host-agnostic: Vapor hard-codes `document.*`, we require the host to inject
 * these operations.
 */

/** Minimal node surface runtime-core needs from a host node. */
export interface RendererNode {
  /** opaque; hosts may attach marker fields to speed up identity checks */
  [key: string]: unknown
}

export interface RendererElement extends RendererNode {
  /** how the host addresses a child operation target */
  readonly [Symbol.toStringTag]?: string
}

/**
 * The operations a host must implement for runtime-core to create, mutate and
 * remove nodes without knowing what they are.
 */
export interface RendererOptions<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
> {
  /** Create an element of the given tag. */
  createElement(type: string): HostElement
  /** Create a text node. */
  createText(text: string): HostNode
  /** Insert `child` into `parent` before `anchor` (or append if anchor null). */
  insert(child: HostNode, parent: HostElement, anchor?: HostNode | null): void
  /** Remove a node from its parent. */
  remove(child: HostNode): void
  /** Set a text node's value. */
  setText(node: HostNode, text: string): void
  /** Replace all children of an element with a single text value. */
  setElementText(el: HostElement, text: string): void
  /** Get the parent element of a node (null at root). */
  parentNode(node: HostNode): HostElement | null
  /** Get the next sibling of a node (null if last). */
  nextSibling(node: HostNode): HostNode | null
  /**
   * Set/remove a single property, event or attribute on an element.
   * This is the fine-grained update latch: dynamic bindings route here.
   */
  patchProp(
    el: HostElement,
    key: string,
    prev: unknown,
    next: unknown,
    isSVG?: boolean,
  ): void
}
