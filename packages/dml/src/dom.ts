/**
 * DOM-side framework surface.
 *
 * Builds a single DOM renderer and exposes the low-level building blocks that
 * TSDML-compiled code (or hand-written DML calls) invoke: `e()` to create an
 * element, plus `mount()`/`createApp()` to attach a root to the page.
 */

import { createDOMRenderer } from "@dml/runtime-dom"
import type { RendererElement, RendererNode } from "@dml/runtime-core"
import { createReactiveElement } from "./reactive.js"

/** A node produced by the DOM renderer. */
export type DMLNode = RendererNode
export type DMLElement = RendererElement

export const domRenderer = createDOMRenderer()

export type Children = Array<DMLNode | string | (() => unknown)> | DMLNode | string | (() => unknown)

/**
 * Create a DOM element with fine-grained reactive bindings. The primary target
 * of TSDML compilation:
 *   e("div", { class: "x" }, e("p", {}, count()))
 * A callable prop value or child is bound reactively (patched on change).
 */
export function h(
  tag: string,
  props?: Record<string, unknown> | null,
  children?: Children,
): RendererElement {
  return createReactiveElement(domRenderer, tag, props, children as never)
}

/** Alias kept short and familiar. */
export const e = h

/** Mount a rendered node into a real DOM container. */
export function mount(node: RendererNode, container: HTMLElement): void {
  if (container.firstChild) domRenderer.nodeOps.removeChildren?.(container as never)
  domRenderer.mount(node, container as never)
}

export interface App {
  mount(container: HTMLElement): void
}

/**
 * Minimal app factory: takes a root factory (e.g. `() => component()`),
 * mounts it on request. The root factory may return an element or a
 * dynamic fragment (later). HMR/scope wiring lands here in later phases.
 */
export function createApp(rootFactory: () => RendererNode): App {
  return {
    mount(container) {
      mount(rootFactory(), container)
    },
  }
}
