/**
 * DML schema types — describe what DML elements/props a component accepts.
 * This is a light, extensible core; the TSDML compiler and runtime may attach
 * richer validators. Schema lives here so both compiler (via types) and runtime
 * share one source of truth.
 */

export type DMLTypeName =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "element"
  | "text"
  | "sequence"
  | "array"
  | "object"

export interface DMLAttrSchema {
  name: string
  type: DMLTypeName
  required?: boolean
  default?: unknown
}

export interface DMLElementSchema {
  /** element tag, e.g. "div" or a component name */
  name: string
  attrs?: DMLAttrSchema[]
  /** allowed children: element names or "text"/"sequence" */
  children?: Array<string | "text" | "sequence">
  /** namespace prefix this element belongs to, optional */
  ns?: string
}

/** A schema document: an ordered collection of element schemas. */
export interface DMLSchema {
  root?: string
  elements: Record<string, DMLElementSchema>
}
