/**
 * @dml/runtime-dom — public entry.
 *
 * Provides the browser-DOM host for runtime-core by supplying concrete
 * nodeOps and patchProp, then building a renderer via createRenderer.
 * Importing this pulls in the DOM; runtime-core itself does not.
 */
import { patchProp } from "./patchProp.js";
export * from "./nodeOps.js";
export * from "./patchProp.js";
/** The DOM host for runtime-core's RendererOptions. */
export declare const domRendererOptions: {
    createElement(tag: string): import("@dml/runtime-core").RendererElement;
    createText(text: string): import("@dml/runtime-core").RendererNode;
    insert(child: import("@dml/runtime-core").RendererNode, parent: import("@dml/runtime-core").RendererElement, anchor?: import("@dml/runtime-core").RendererNode | null): void;
    remove(child: import("@dml/runtime-core").RendererNode): void;
    setText(node: import("@dml/runtime-core").RendererNode, text: string): void;
    setElementText(el: import("@dml/runtime-core").RendererElement, text: string): void;
    parentNode(node: import("@dml/runtime-core").RendererNode): import("@dml/runtime-core").RendererElement | null;
    nextSibling(node: import("@dml/runtime-core").RendererNode): import("@dml/runtime-core").RendererNode | null;
    patchProp: typeof patchProp;
};
/** A renderer bound to the browser DOM. */
export declare function createDOMRenderer(): import("@dml/runtime-core").Renderer<import("@dml/runtime-core").RendererNode, import("@dml/runtime-core").RendererElement>;
//# sourceMappingURL=index.d.ts.map