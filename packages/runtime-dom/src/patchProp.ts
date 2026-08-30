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

import type { RendererElement } from "@dml/runtime-core"

type Target = Element & {
  _vei?: Record<
    string,
    { handler: ((e: unknown) => void) | null; listener: EventListener } | undefined
  >
}

const isOn = (key: string) => key.length > 2 && key.startsWith("on")
const isXlink = (key: string) => key.startsWith("xlink:")

function patchEvent(
  el: Target,
  rawName: string,
  prev: unknown,
  next: unknown,
): void {
  const name = rawName.charAt(2).toLowerCase() + rawName.slice(3)
  const invokers = (el._vei || (el._vei = {}))
  const existing = invokers[name]

  if (next) {
    if (!existing) {
      // first binding: install a stable invoker that reads the current handler
      const entry = { handler: next as (e: unknown) => void, listener: null as unknown as EventListener }
      const listener = ((e: unknown) => {
        entry.handler?.(e)
      }) as EventListener
      entry.listener = listener
      invokers[name] = entry
      el.addEventListener(name, listener)
    } else {
      // update handler on the cached invoker without swapping the listener
      existing.handler = next as (e: unknown) => void
    }
  } else if (existing) {
    el.removeEventListener(name, existing.listener)
    invokers[name] = undefined
  }
}

export function patchProp(
  el: RendererElement,
  key: string,
  prev: unknown,
  next: unknown,
  isSVG = false,
): void {
  const target = el as unknown as Target

  if (key === "class") {
    if (next != null) {
      target.className = String(next)
    } else {
      target.removeAttribute("class")
    }
  } else if (key === "style") {
    const style = (target as HTMLElement).style
    if (next == null) {
      style.cssText = ""
    } else if (typeof next === "string") {
      style.cssText = next
    } else {
      const obj = next as Record<string, string | number | undefined>
      for (const k in obj) {
        ;(style as unknown as Record<string, string>)[k] = String(obj[k] ?? "")
      }
    }
  } else if (isOn(key)) {
    patchEvent(target, key, prev, next)
  } else if (isSVG && isXlink(key)) {
    const ns = "http://www.w3.org/1999/xlink"
    if (next != null) {
      target.setAttributeNS(ns, key, String(next))
    } else {
      target.removeAttributeNS(ns, key.slice("xlink:".length))
    }
  } else if (key in target && key !== "list") {
    // prefer DOM property when it exists
    if (next === undefined || next === null) {
      ;(target as unknown as Record<string, unknown>)[key] = ""
      target.removeAttribute(key)
    } else {
      ;(target as unknown as Record<string, unknown>)[key] = next
    }
  } else if (next !== undefined && next !== null) {
    target.setAttribute(key, String(next))
  } else {
    target.removeAttribute(key)
  }
}
