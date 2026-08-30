/**
 * nodeOps — the DOM implementation of RendererOptions' node operations.
 *
 * This is the only place in the framework that calls `document.*` directly.
 * runtime-core never touches these.
 */
import type { RendererNode, RendererElement } from "@dml/runtime-core";
/** Cast DOM nodes into the host-node surface. */
export declare const DOMNode: (n: Node) => RendererNode;
export declare const DOMElement: (n: Element) => RendererElement;
export declare const nodeOps: {
    createElement(tag: string): RendererElement;
    createText(text: string): RendererNode;
    insert(child: RendererNode, parent: RendererElement, anchor?: RendererNode | null): void;
    remove(child: RendererNode): void;
    setText(node: RendererNode, text: string): void;
    setElementText(el: RendererElement, text: string): void;
    parentNode(node: RendererNode): RendererElement | null;
    nextSibling(node: RendererNode): RendererNode | null;
};
//# sourceMappingURL=nodeOps.d.ts.map