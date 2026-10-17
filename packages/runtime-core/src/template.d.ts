/**
 * template-kit — the runtime side of the optimizing compiler backend.
 *
 * `@tsdml/compiler` lowers a template block into a *static shape* plus
 * index-addressed bindings:
 *
 *   const _$t0 = _$template(["div",{"class":"page-root"},[""]]);
 *   export function Counter() {
 *     const _n$ = _$t0();
 *     _$insert(_n$[1], () => count.read());
 *     return _n$[0];
 *   }
 *
 * This module turns that into running code, host-agnostically:
 *
 *   - `template(shape)` builds the static shape ONCE per template and then
 *     clones it per instance (`cloneNode`) — the host does one native deep
 *     copy instead of re-creating every element, and no props objects or
 *     children arrays are allocated per render. Hosts without `cloneNode`
 *     fall back to rebuilding the shape (correct, just slower).
 *   - nodes are addressed by their index in the flat, pre-order walk, so a
 *     binding is an array lookup — no firstChild/nextSibling walking, no
 *     querySelector.
 *   - `insert(anchor, value)` is the only dynamic-child primitive: it accepts
 *     a value or an accessor, and re-renders in place inside a render effect.
 *   - `setProp` applies once; `setPropReactive` tracks; `on` binds an event
 *     (events are never reactive).
 */
import type { RendererElement, RendererNode, RendererOptions } from "./types.js";
/**
 * A static template shape.
 *
 * - `"text"` — a text node
 * - `[tag, props, children]` — an element; `props`/`children` may be null
 *
 * Dynamic values never appear here: they are bindings applied afterwards.
 * An empty string is a *placeholder* node that a dynamic child is inserted
 * before (it keeps the insertion point, so static siblings keep their order).
 */
export type Shape = string | [string, Record<string, unknown> | null, Shape[] | null];
/** Host operations the template kit additionally needs. */
export interface TemplateKitOptions<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement> extends RendererOptions<HostNode, HostElement> {
    /** Deep/shallow clone. Absent → instances are rebuilt from the shape. */
    cloneNode?(node: HostNode, deep: boolean): HostNode;
    /** Namespace-aware element creation (SVG). Absent → createElement. */
    createElementNS?(tag: string, isSVG: boolean): HostElement;
    /** Is this value a host node (as opposed to a primitive child value)? */
    isNode?(value: unknown): boolean;
    /**
     * Direct children of a node, in order. With this op a template instance is
     * produced by deep-cloning the roots and pairing the clone's descendants with
     * the prototype's — no per-node insert. Without it every node is cloned
     * shallow and re-attached one by one (correct, just slower).
     */
    children?(node: HostNode): HostNode[];
}
/** The primitives a compiled template calls. */
export interface TemplateKit<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement> {
    /** Hoist a static shape; returns the instantiate function. */
    template(shape: Shape): () => HostNode[];
    /** Insert (or re-insert, when given an accessor) a dynamic child. */
    insert(anchor: HostNode, value: unknown): void;
    /** Apply a non-reactive property once. */
    setProp(el: HostElement, key: string, value: unknown, isSVG?: boolean): void;
    /** Track a reactive property. */
    setPropReactive(el: HostElement, key: string, read: () => unknown, isSVG?: boolean): void;
    /** Bind an event handler. */
    on(el: HostElement, key: string, handler: unknown): void;
    /** Append a value (or accessor) to a container — the app entry point. */
    mount(value: unknown, container: HostElement): void;
    /**
     * Keyed list: `each(() => items, (item) => value, (item) => key)`.
     *
     * Returns an **accessor** (a value the kit's `insert` evaluates), not a writer
     * into an anchor: `@if` and *unkeyed* `@for` need no runtime state at all (the
     * compiler emits `insert(anchor, () => cond ? value : null)` /
     * `() => Array.from(items).map(…)` and the accessor path swaps the content),
     * while keyed reuse needs the one piece of state this holds — the value each
     * key produced last time, so surviving items keep their nodes.
     */
    each(list: () => unknown, factory: (item: unknown) => unknown, key: (item: unknown) => unknown): () => unknown;
}
export declare function createTemplateKit<HostNode extends RendererNode = RendererNode, HostElement extends RendererElement = RendererElement>(options: TemplateKitOptions<HostNode, HostElement>): TemplateKit<HostNode, HostElement>;
//# sourceMappingURL=template.d.ts.map