/**
 * patchProp — fine-grained single-property updater for the DOM host.
 *
 * Routes one key to the right DOM write path:
 *   - `onXxx`        → event listener (add/remove)
 *   - `class`        → className
 *   - `style`        → style object/string
 *   - `value`/DOM prop vs attribute → DOM property if present, else attribute
 *   - SVG namespace handling for `xlink:*`
 *
 * Signature matches RendererOptions.patchProp(el, key, prev, next, isSVG):
 * the `prev` value is used to decide whether a change is needed (esp. events).
 */
import type { RendererElement } from "@dml/runtime-core";
export declare function patchProp(el: RendererElement, key: string, prev: unknown, next: unknown, isSVG?: boolean): void;
//# sourceMappingURL=patchProp.d.ts.map