/**
 * Type-level tests for the TSDML runtime `e` function.
 *
 * These don't run at runtime — they assert the *types* are correct. If any
 * `@ts-expect-error` line stops erroring (or a valid line starts erroring),
 * the typecheck fails, which is exactly what we want: it proves the generic
 * `e` gives TSX-parity tag/attribute/event/CSS inference.
 */

import { describe, expect, it } from "vitest"
import type { E, DML } from "../src/tsdml-runtime.js"

// ---- declaration merging: directives, custom events, explicit bindings ----
declare module "../src/tsdml-runtime.js" {
  namespace DML {
    interface Directives {
      clickOutside: (el: HTMLElement, accessor: () => boolean) => void;
    }
    interface CustomEvents {
      myEvent: CustomEvent<{ id: number }>;
    }
    interface ExplicitProperties {
      value: string;
    }
    interface ExplicitAttributes {
      href: string;
    }
    interface ExplicitBoolAttributes {
      disabled: boolean;
    }
  }
}

// ---- valid usages (must type-check) ----

const e = (() => {}) as unknown as E

// tag-name + attribute inference
const div = e("div", { class: "x", id: "app" })
const button = e("button", { type: "submit", disabled: true })
const input = e("input", { type: "text", value: "hi", placeholder: "name" })
const img = e("img", { src: "a.png", alt: "a", width: 100 })

// event handler inference: onClick receives a MouseEvent
e("div", {
  onClick: (ev) => {
    const x: number = ev.clientX
    const t: HTMLElement = ev.currentTarget
    void x
    void t
  },
})

// input event: onChange receives a typed event
e("input", {
  onChange: (ev) => {
    const v: string = ev.currentTarget.value
    void v
  },
})

// CSS via csstype
e("div", {
  style: {
    color: "red",
    display: "flex",
    "background-color": "#fff",
    "--custom": "10px",
  },
})

// reactive accessor as prop (FunctionMaybe)
const read = () => "x"
e("div", { class: read })

// children: string, number, element, array, accessor
e("div", null, "text")
e("div", null, 42)
e("div", null, e("span", null, "hi"))
e("div", null, [e("span", null, "a"), e("span", null, "b")])
e("div", null, () => "reactive")

// SVG tag
e("svg", { viewBox: "0 0 100 100" }, e("circle", { cx: 50, cy: 50, r: 40 }))

// ---- beyond-TSX features ----

// arbitrary data-* attributes (TSX does not complete these)
e("div", { "data-id": "42", "data-testid": "root", "data-count": 3 })

// key for list reconciliation
e("div", { key: "item-1" })

// $ServerOnly SSR marker
e("div", { $ServerOnly: true })

// classList boolean map
e("div", { classList: { active: true, hidden: false } })

// ref with typed element
e("div", {
  ref: (el) => {
    const d: HTMLDivElement = el
    void d
  },
})

// style with CSS variables
e("div", {
  style: {
    color: "red",
    "--brand-color": "#0af",
    "--spacing": "8px",
  },
})

// ---- declaration-merged features ----

// typed directive (use:clickOutside)
e("div", {
  "use:clickOutside": (el, accessor) => {
    const e2: HTMLElement = el
    const on: boolean = accessor()
    void e2
    void on
  },
})

// typed custom event (on:myEvent) — detail is typed
e("div", {
  "on:myEvent": (ev) => {
    const id: number = ev.detail.id
    void id
  },
})

// explicit property binding (prop:value)
e("input", { "prop:value": "hello" })

// explicit attribute binding (attr:href)
e("a", { "attr:href": "/path" })

// explicit boolean attribute (bool:disabled)
e("button", { "bool:disabled": true })

// ---- invalid usages (must error) ----

// @ts-expect-error — unknown tag
e("notatag", {})

// @ts-expect-error — wrong prop type (onClick must be a function)
e("div", { onClick: 123 })

// @ts-expect-error — wrong prop type (class must be string)
e("div", { class: 42 })

// @ts-expect-error — unknown attribute
e("div", { notARealAttr: "x" })

// @ts-expect-error — wrong event handler signature
e("div", { onClick: (n: number) => n })

// @ts-expect-error — button type is a union, not arbitrary string
e("button", { type: "not-a-button-type" })

// @ts-expect-error — data-* must be string/number/boolean, not object
e("div", { "data-x": {} })

// @ts-expect-error — key must be string/number
e("div", { key: {} })

// @ts-expect-error — classList values must be boolean
e("div", { classList: { active: "yes" } })

// ---- DML namespace surface ----

describe("tsdml-runtime types", () => {
  it("exposes IntrinsicElements with div/span/button", () => {
    const keys: (keyof DML.IntrinsicElements)[] = ["div", "span", "button", "svg", "input"]
    expect(keys).toContain("div")
  })

  it("exposes the E type", () => {
    const fn: E = (() => {}) as unknown as E
    expect(typeof fn).toBe("function")
  })
})
