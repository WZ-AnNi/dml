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
import { createNodeOps } from "./block.js";
import type { RendererElement, RendererNode, RendererOptions } from "./types.js";
export interface Renderer<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement> {
    /** Create an element (children joined). Static props applied now. */
    createElement(tag: string, props?: Record<string, unknown> | null, children?: Array<HostNode | string> | HostNode | string): HostElement;
    /** Create a static text node. */
    createText(text: string): HostNode;
    /** Mount a node into `parent` before `anchor` (append if null). */
    mount(node: HostNode, parent: HostElement, anchor?: HostNode | null): void;
    /**
     * Fine-grained patch: apply one property/event/attr value. Used inside a
     * render-effect for dynamic bindings. `prev` lets the host skip no-ops.
     */
    patch(el: HostElement, key: string, prev: unknown, next: unknown, isSVG?: boolean): void;
    /** Raw host operations (for advanced/block-level use). */
    nodeOps: ReturnType<typeof createNodeOps<HostNode, HostElement>>;
}
export declare function createRenderer<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement>(options: RendererOptions<HostNode, HostElement>): Renderer<HostNode, HostElement>;
//# sourceMappingURL=renderer.d.ts.map