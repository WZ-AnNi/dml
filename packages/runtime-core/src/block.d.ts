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
import type { RendererElement, RendererNode, RendererOptions } from "./types.js";
/** Anything the renderer can mount as a child. */
export type Block<HostNode = RendererNode> = HostNode | Block<HostNode>[];
/** A set of node operations bound to a concrete host (created by createRenderer). */
export interface NodeOps<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement> {
    insert(child: HostNode, parent: HostElement, anchor?: HostNode | null): void;
    remove(child: HostNode): void;
    removeChildren(parent: HostElement): void;
}
/**
 * Build the node-operation surface for a given host options. Kept separate from
 * createRenderer so block-level logic can be unit-tested against any host.
 */
export declare function createNodeOps<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement>(options: RendererOptions<HostNode, HostElement>): NodeOps<HostNode, HostElement>;
/**
 * Insert a Block into a parent before an anchor. Flattens Block[] groups.
 * Anchor `0` (number) is not used here to keep host signature simple; pass null
 * to append.
 */
export declare function insertBlock<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement>(ops: NodeOps<HostNode, HostElement>, block: Block<HostNode>, parent: HostElement, anchor?: HostNode | null): void;
/** Remove a Block from its parent. */
export declare function removeBlock<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement>(ops: NodeOps<HostNode, HostElement>, block: Block<HostNode>, parent?: HostElement): void;
//# sourceMappingURL=block.d.ts.map