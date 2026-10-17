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

import { createEffect } from "@dml/reactivity"
import type {
  RendererElement,
  RendererNode,
  RendererOptions,
} from "./types.js"

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
export type Shape =
  | string
  | [string, Record<string, unknown> | null, Shape[] | null]

/** Host operations the template kit additionally needs. */
export interface TemplateKitOptions<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
> extends RendererOptions<HostNode, HostElement> {
  /** Deep/shallow clone. Absent → instances are rebuilt from the shape. */
  cloneNode?(node: HostNode, deep: boolean): HostNode
  /** Namespace-aware element creation (SVG). Absent → createElement. */
  createElementNS?(tag: string, isSVG: boolean): HostElement
  /** Is this value a host node (as opposed to a primitive child value)? */
  isNode?(value: unknown): boolean
  /**
   * Direct children of a node, in order. With this op a template instance is
   * produced by deep-cloning the roots and pairing the clone's descendants with
   * the prototype's — no per-node insert. Without it every node is cloned
   * shallow and re-attached one by one (correct, just slower).
   */
  children?(node: HostNode): HostNode[]
}

/** The primitives a compiled template calls. */
export interface TemplateKit<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
> {
  /** Hoist a static shape; returns the instantiate function. */
  template(shape: Shape): () => HostNode[]
  /** Insert (or re-insert, when given an accessor) a dynamic child. */
  insert(anchor: HostNode, value: unknown): void
  /** Apply a non-reactive property once. */
  setProp(el: HostElement, key: string, value: unknown, isSVG?: boolean): void
  /** Track a reactive property. */
  setPropReactive(
    el: HostElement,
    key: string,
    read: () => unknown,
    isSVG?: boolean,
  ): void
  /** Bind an event handler. */
  on(el: HostElement, key: string, handler: unknown): void
  /** Append a value (or accessor) to a container — the app entry point. */
  mount(value: unknown, container: HostElement): void
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
  each(
    list: () => unknown,
    factory: (item: unknown) => unknown,
    key: (item: unknown) => unknown,
  ): () => unknown
}

export function createTemplateKit<
  HostNode extends RendererNode = RendererNode,
  HostElement extends RendererElement = RendererElement,
>(options: TemplateKitOptions<HostNode, HostElement>): TemplateKit<HostNode, HostElement> {
  const isNode =
    options.isNode ??
    ((v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v))

  interface Built {
    nodes: HostNode[]
    /** parent index per node; -1 = root */
    parents: number[]
  }

  /** Build one instance of a shape, recording the flat pre-order node list. */
  function build(shape: Shape, built: Built, svgContext: boolean): number {
    if (typeof shape === "string") {
      const idx = built.nodes.length
      built.nodes.push(options.createText(shape) as HostNode)
      built.parents.push(-1)
      return idx
    }
    const [tag, props, children] = shape
    const isSVG = svgContext || tag === "svg"
    const el = options.createElementNS
      ? options.createElementNS(tag, isSVG)
      : options.createElement(tag)
    const idx = built.nodes.length
    built.nodes.push(el as unknown as HostNode)
    built.parents.push(-1)
    if (props) {
      for (const key in props) {
        options.patchProp(el, key, undefined, props[key], isSVG)
      }
    }
    if (children) {
      for (const child of children) {
        const childIdx = build(child, built, isSVG)
        built.parents[childIdx] = idx
        options.insert(
          built.nodes[childIdx],
          el,
          null,
        )
      }
    }
    return idx
  }

  function instantiate(shape: Shape, proto?: Built): HostNode[] {
    if (!options.cloneNode || !proto) {
      const built: Built = { nodes: [], parents: [] }
      build(shape, built, false)
      return built.nodes
    }
    const cloneNode = options.cloneNode
    const childOf = options.children
    if (!childOf) {
      // No child access on this host: clone every node shallow and re-attach in
      // pre-order (children are appended to their already-cloned parent).
      const nodes: HostNode[] = []
      for (let i = 0; i < proto.nodes.length; i++) {
        const clone = cloneNode(proto.nodes[i], false)
        nodes.push(clone)
        const parent = proto.parents[i]
        if (parent >= 0) {
          options.insert(clone, nodes[parent] as unknown as HostElement, null)
        }
      }
      return nodes
    }
    // Fast path: deep-clone the roots and pair each prototype node with its
    // counterpart inside the clone (same pre-order, so no inserts at all).
    const childIndexes: number[][] = proto.nodes.map(() => [])
    const roots: number[] = []
    proto.parents.forEach((parent, index) => {
      if (parent < 0) roots.push(index)
      else childIndexes[parent]!.push(index)
    })
    const nodes: HostNode[] = new Array(proto.nodes.length)
    const pair = (protoIndex: number, clone: HostNode): void => {
      nodes[protoIndex] = clone
      const cloneChildren = childOf(clone)
      const protoChildren = childIndexes[protoIndex]!
      for (let i = 0; i < protoChildren.length; i++) {
        const childClone = cloneChildren[i]
        if (childClone === undefined) return
        pair(protoChildren[i]!, childClone)
      }
    }
    for (const root of roots) {
      pair(root, cloneNode(proto.nodes[root]!, true))
    }
    return nodes
  }

  /** Remove previously inserted dynamic children. */
  function removeAll(inserted: HostNode[]): void {
    for (const node of inserted) options.remove(node)
    inserted.length = 0
  }

  /**
   * What one binding has put into the DOM.
   *
   * `nodes` are the nodes of the *last* update; `managers` are the states of
   * nested accessors (an `@if` child handed to a component, an accessor inside
   * a children array). Clearing a state recursively clears everything it owns,
   * which is what keeps a re-render from leaving orphans behind.
   */
  interface InsertState {
    nodes: HostNode[]
    managers: InsertState[]
  }

  const newState = (): InsertState => ({ nodes: [], managers: [] })

  function clearState(state: InsertState): void {
    removeAll(state.nodes)
    for (const nested of state.managers) clearState(nested)
    state.managers.length = 0
  }

  /** Put `value` (node / text / array / accessor) in front of `anchor`. */
  function insertValue(anchor: HostNode, value: unknown, state: InsertState): void {
    if (typeof value === "function") {
      // an accessor keeps itself up to date in its own render effect
      const nested = newState()
      state.managers.push(nested)
      bindAccessor(anchor, value as () => unknown, nested)
      return
    }
    if (value == null || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) insertValue(anchor, item, state)
      return
    }
    if (typeof value === "string" || typeof value === "number") {
      if (state.nodes.length === 0 && state.managers.length === 0) {
        // fast path: a lone primitive reuses the placeholder text node (which
        // is NOT tracked in `state.nodes` — it must survive re-renders)
        options.setText(anchor, String(value))
        return
      }
      const text = options.createText(String(value)) as HostNode
      const parent = options.parentNode(anchor)
      if (parent) options.insert(text, parent, anchor)
      state.nodes.push(text)
      return
    }
    if (isNode(value)) {
      const parent = options.parentNode(anchor)
      if (parent) options.insert(value as HostNode, parent, anchor)
      state.nodes.push(value as HostNode)
      return
    }
    options.setText(anchor, String(value))
  }

  /** Re-evaluate `read()` whenever its signals change. */
  function bindAccessor(
    anchor: HostNode,
    read: () => unknown,
    state: InsertState = newState(),
  ): void {
    createEffect(() => {
      clearState(state)
      insertValue(anchor, read(), state)
    })
  }

  return {
    template(shape) {
      let proto: Built | undefined
      if (options.cloneNode) {
        proto = { nodes: [], parents: [] }
        build(shape, proto, false)
      }
      return () => instantiate(shape, proto)
    },

    insert(anchor, value) {
      insertValue(anchor, value, newState())
    },

    setProp(el, key, value, isSVG) {
      options.patchProp(el, key, undefined, value, isSVG)
    },

    setPropReactive(el, key, read, isSVG) {
      let prev: unknown
      let initialised = false
      createEffect(() => {
        const next = read()
        if (initialised && next === prev) return
        options.patchProp(el, key, prev, next, isSVG)
        prev = next
        initialised = true
      })
    },

    on(el, key, handler) {
      options.patchProp(el, key, undefined, handler)
    },

    each(list, factory, key) {
      // `@for (x of items).key(x.id)` → an accessor whose value is the ordered
      // list of items' values. Surviving keys reuse the value `factory` already
      // produced, so the nodes keep their identity (and `insert` moves rather
      // than rebuilds them). Returning an accessor — instead of writing into a
      // caller-supplied anchor — is what lets keyed `@for` work in ANY position:
      // element child, component children, another directive's body, or the
      // block root.
      const built = new Map<unknown, unknown>()
      return () => {
        const items = Array.from((list() as Iterable<unknown>) ?? [])
        const live = new Set<unknown>()
        const out: unknown[] = []
        for (const item of items) {
          const k = key(item)
          if (!built.has(k)) built.set(k, factory(item))
          live.add(k)
          out.push(built.get(k))
        }
        for (const k of [...built.keys()]) {
          if (!live.has(k)) built.delete(k)
        }
        return out
      }
    },

    mount(value, container) {
      const anchor = options.createText("") as HostNode
      options.insert(anchor, container, null)
      if (typeof value === "function") {
        bindAccessor(anchor, value as () => unknown)
      } else {
        insertValue(anchor, value, newState())
      }
    },
  }
}
