/**
 * @dml/cli — library surface.
 *
 * Interprets a DML document as *configuration* (one of DML's two readings):
 * an element becomes an object/array entry, `@attr` becomes a property,
 * text becomes a scalar, repeated child elements become arrays.
 * Parsing is done by the native @tsdml/compiler; this module only restructures
 * the AST JSON into a plain config object.
 */

import { parse, type DmlElementJson, type DmlMemberJson, type DmlValueJson } from "@tsdml/compiler"

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ConfigValue[]
  | { [k: string]: ConfigValue }

/** Read a DML file and interpret it as a config object. */
export function loadDmlConfig(source: string): Record<string, ConfigValue> {
  const root = parse(source)
  return elementToConfig(root) as Record<string, ConfigValue>
}

export function elementToConfig(el: DmlElementJson): ConfigValue {
  const out: Record<string, ConfigValue> = {}
  const children: Record<string, ConfigValue[]> = {}

  for (const m of el.members) {
    switch (m.kind) {
      case "attribute":
        out[m.name] = valueToConfig(m.value)
        break
      case "text":
        out["#text"] = m.value
        break
      case "element": {
        const cfg = elementToConfig(m)
        const key = m.name
        if (Array.isArray(children[key])) children[key]!.push(cfg)
        else children[key] = [cfg]
        break
      }
      case "namespaceScope":
        for (const inner of m.inner) {
          if (inner.kind === "attribute") {
            out[`${m.prefix}:${inner.name}`] = valueToConfig(inner.value)
          }
        }
        break
      case "sequence":
        for (const item of m.items) {
          if (item.kind === "element") {
            const cfg = elementToConfig(item)
            const key = item.name
            if (Array.isArray(children[key])) children[key]!.push(cfg)
            else children[key] = [cfg]
          } else if (item.kind === "text") {
            out["#text"] = item.value
          }
        }
        break
    }
  }

  // child elements: single → scalar, multiple → array
  for (const [key, list] of Object.entries(children)) {
    out[key] = list.length === 1 ? list[0]! : list
  }
  return out
}

function valueToConfig(v: DmlValueJson): ConfigValue {
  switch (v.type) {
    case "string":
    case "number":
    case "boolean":
      return v.value as string | number | boolean
    case "null":
      return null
    case "bare":
      return v.value
    case "expr":
      return v.value
    case "array":
      return v.items.map(valueToConfig)
    case "object": {
      const o: Record<string, ConfigValue> = {}
      for (const [k, val] of Object.entries(v.value)) {
        o[k] = valueToConfig(val)
      }
      return o
    }
  }
}