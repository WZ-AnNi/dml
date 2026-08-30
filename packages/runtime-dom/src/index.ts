/**
 * @dml/runtime-dom — public entry.
 *
 * Provides the browser-DOM host for runtime-core by supplying concrete
 * nodeOps and patchProp, then building a renderer via createRenderer.
 * Importing this pulls in the DOM; runtime-core itself does not.
 */

import { createRenderer } from "@dml/runtime-core"
import { nodeOps } from "./nodeOps.js"
import { patchProp } from "./patchProp.js"

export * from "./nodeOps.js"
export * from "./patchProp.js"

/** The DOM host for runtime-core's RendererOptions. */
export const domRendererOptions = { ...nodeOps, patchProp }

/** A renderer bound to the browser DOM. */
export function createDOMRenderer() {
  return createRenderer(domRendererOptions)
}
