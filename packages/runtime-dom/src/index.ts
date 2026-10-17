/**
 * @dml/runtime-dom — public entry.
 *
 * Provides the browser-DOM host for runtime-core by supplying concrete
 * nodeOps and patchProp, then building a renderer via createRenderer.
 * Importing this pulls in the DOM; runtime-core itself does not.
 */

import { createRenderer, createTemplateKit } from "@dml/runtime-core"
import { nodeOps } from "./nodeOps.js"
import { patchProp } from "./patchProp.js"

export * from "./nodeOps.js"
export * from "./patchProp.js"
// Re-export the template `E()` type AND the `Element` it returns from the
// PUBLIC entry so plain `.ts` and `.tsdml` modules reference ONE of each. The
// editor's typed IR (the `__dml_e(tag, props, children)` lowering the TS server
// type-checks) imports `E` from here; `Element` is what a slot prop holds, so
// components type their slots with it instead of `unknown`.
export type { E, Element } from "./tsdml-runtime.js"

/** The DOM host for runtime-core's RendererOptions. */
export const domRendererOptions = { ...nodeOps, patchProp }

/** A renderer bound to the browser DOM. */
export function createDOMRenderer() {
  return createRenderer(domRendererOptions)
}

/**
 * The primitives compiled `.tsdml` modules call. Bound to the DOM host, so a
 * component is just `function Counter(props) { ... return @{ ... } }` — no
 * renderer argument, exactly like Solid/Vue components.
 */
export const { template, insert, setProp, setPropReactive, on, mount, each } =
  createTemplateKit(domRendererOptions)
