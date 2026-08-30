/**
 * Block — the 0-VDOM render unit.
 *
 * Unlike a vnode tree (data describing a DOM tree to diff), a Block is the
 * actual host node (or a multi-root group / dynamic fragment) plus enough
 * structure to insert/remove it. Vapor calls the same concept "Block".
 *
 * Block = HostNode | HostText | Block[]  (dynamic fragments come later)
 *
 * All DOM access goes through the injected RendererOptions (host-agnostic).
 */

import type {
  RendererElement,
  RendererNode,
  RendererOptions,
} from "./types.js"

/** Anything the renderer can mount as a child. */
export type Block<HostNode = RendererNode> = HostNode | Block<HostNode>[]

/** A set of node operations bound to a concrete host (created by createRenderer). */
export interface NodeOps<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
> {
  insert(
    child: HostNode,
    parent: HostElement,
    anchor?: HostNode | null,
  ): void
  remove(child: HostNode): void
  removeChildren(parent: HostElement): void
}

/**
 * Build the node-operation surface for a given host options. Kept separate from
 * createRenderer so block-level logic can be unit-tested against any host.
 */
export function createNodeOps<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
>(options: RendererOptions<HostNode, HostElement>): NodeOps<HostNode, HostElement> {
  const { insert, remove, parentNode } = options

  return {
    insert,
    remove,
    removeChildren(parent) {
      let child = parentNode(parent.firstChild as HostNode) as unknown as
        | HostNode
        | null
      while (child) {
        remove(child)
        const next = parentNode(parent.firstChild as HostNode) as unknown as
          | HostNode
          | null
        if (next === child) break // defensive: host should advance on remove
        child = next
      }
    },
  }
}

/**
 * Insert a Block into a parent before an anchor. Flattens Block[] groups.
 * Anchor `0` (number) is not used here to keep host signature simple; pass null
 * to append.
 */
export function insertBlock<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
>(
  ops: NodeOps<HostNode, HostElement>,
  block: Block<HostNode>,
  parent: HostElement,
  anchor?: HostNode | null,
): void {
  if (Array.isArray(block)) {
    let a = anchor ?? null
    // insert in reverse so the last element ends up immediately before `anchor`
    for (let i = block.length - 1; i >= 0; i--) {
      ops.insert(block[i] as HostNode, parent, a)
      a = block[i] as HostNode
    }
  } else {
    ops.insert(block as HostNode, parent, anchor ?? null)
  }
}

/** Remove a Block from its parent. */
export function removeBlock<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
>(
  ops: NodeOps<HostNode, HostElement>,
  block: Block<HostNode>,
  parent?: HostElement,
): void {
  if (Array.isArray(block)) {
    for (let i = 0; i < block.length; i++) {
      removeBlock(ops, block[i] as Block<HostNode>, parent)
    }
  } else if (parent) {
    if ((block as HostNode) !== (parent.firstChild as HostNode)) {
      ops.remove(block as HostNode)
    }
  }
}
