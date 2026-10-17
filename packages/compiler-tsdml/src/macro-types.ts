/**
 * Macro component type definitions.
 * 
 * Macro components are user-extensible control flow constructs written as
 * `@name(...) { body }`. Built-in macros (@if, @for, @slot) are registered
 * at compiler startup; users can define custom macros in `*.macro.ts` files.
 */

// ============================================================================
// Token & TokenStream — structured input to macro.parse()
// ============================================================================

/** Token types in a macro head expression */
export type TokenType =
  | "identifier"
  | "keyword"
  | "string"
  | "number"
  | "punctuation"
  | "operator"
  | "whitespace"
  | "eof"

/** A single token from the macro head expression */
export interface Token {
  type: TokenType
  value: string
  /** Byte offset in the original head source */
  start: number
  end: number
}

/** Predefined token constants for type-safe comparison */
export const T_ELSE_IF: Token = { type: "keyword", value: "else if", start: -1, end: -1 }
export const T_ELSE: Token = { type: "keyword", value: "else", start: -1, end: -1 }
export const T_OF: Token = { type: "keyword", value: "of", start: -1, end: -1 }
export const T_IN: Token = { type: "keyword", value: "in", start: -1, end: -1 }

/**
 * TokenStream: structured access to the macro head expression.
 * 
 * Macros call methods on this to parse their head syntax. The stream is
 * backed by the raw head source string, tokenized on demand.
 */
export interface TokenStream {
  /** Peek at the next token without consuming */
  peek(): Token
  
  /** Consume and return the next token */
  next(): Token
  
  /** Try to consume a specific token (e.g., T_ELSE_IF). Returns true if matched. */
  tryConsume(expected: Token): boolean
  
  /** Parse a TypeScript expression (returns the raw source text) */
  parseExpression(): string
  
  /** Parse a binding pattern (identifier or destructuring) */
  parseBinding(): string
  
  /** Check if at end of tokens */
  eof(): boolean
  
  /** Get remaining source text without parsing */
  rest(): string
}

// ============================================================================
// IrExpr — structured output from macro.generate()
// ============================================================================

/**
 * Intermediate representation expression.
 * 
 * Macros return IrExpr from generate(). The compiler translates IrExpr to
 * the appropriate backend output (typed IR or build IR).
 */
export type IrExpr =
  | IrCond
  | IrMap
  | IrKeyedMap
  | IrElement
  | IrExprNode
  | IrText
  | IrArray
  | IrSlot
  | IrComponent
  | IrRaw
  | IrNull

export interface IrCond {
  type: "cond"
  /** Condition expression source */
  cond: string
  /** Branches: [cond, body][] plus optional else */
  branches: Array<{ cond: string | null; body: IrExpr[] }>
}

export interface IrMap {
  type: "map"
  /** Loop binding (e.g., "item", "[k, v]") */
  binding: string
  /** Iterable expression source */
  iter: string
  /** Body to render for each iteration */
  body: IrExpr[]
}

export interface IrKeyedMap {
  type: "keyedMap"
  binding: string
  iter: string
  /** Key expression source (e.g., "item.id") */
  key: string
  body: IrExpr[]
}

export interface IrElement {
  type: "element"
  tag: string
  /** Attributes as [name, value] pairs */
  attrs: Array<{ name: string; value: string | null }>
  children: IrExpr[]
}

export interface IrExprNode {
  type: "expr"
  /** Expression source */
  expr: string
}

export interface IrText {
  type: "text"
  text: string
}

export interface IrArray {
  type: "array"
  items: IrExpr[]
}

export interface IrComponent {
  type: "component"
  name: string
  props: Array<{ name: string; value: string }>
  children: IrExpr[]
}

export interface IrRaw {
  type: "raw"
  /** Raw code to emit verbatim */
  code: string
}

export interface IrNull {
  type: "null"
}

// ============================================================================
// MacroComponent — the interface users implement
// ============================================================================

/** Context passed to macro.generate() */
export interface MacroContext {
  /** Compile a body member list to IrExpr[] */
  compileBody(members: unknown[]): IrExpr[]
  
  /** Report a parse error at a specific position */
  error(message: string, span?: { start: number; end: number }): void
}

/**
 * Macro component interface.
 * 
 * Users implement this in `*.macro.ts` files:
 * 
 * ```ts
 * export const Show: MacroComponent<{ cond: string }> = {
 *   parse(head) {
 *     const cond = head.parseExpression()
 *     return { cond }
 *   },
 *   generate(head, body, ctx) {
 *     return {
 *       type: "cond",
 *       cond: head.cond,
 *       branches: [
 *         { cond: head.cond, body: ctx.compileBody(body) },
 *       ],
 *     }
 *   },
 * }
 * ```
 */
export interface MacroComponent<THead = unknown> {
  /**
   * Parse the macro head expression.
   * 
   * Called once per macro invocation. The TokenStream provides structured
   * access to the head source. Return the parsed head data that will be
   * passed to generate().
   */
  parse(head: TokenStream): THead
  
  /**
   * Generate IR for this macro invocation.
   * 
   * Called after parse(). Receives the parsed head data, the body members
   * (as DML AST nodes), and a context for compiling children.
   * 
   * Return an IrExpr that the compiler will translate to backend output.
   */
  generate(head: THead, body: unknown[], ctx: MacroContext): IrExpr
  
  /**
   * Optional: semantic mapping for editor features.
   * 
   * Maps raw source spans to semantic roles (e.g., "condition", "binding").
   * Used for hover, go-to-definition, etc.
   */
  mapSemantics?(head: THead, spans: Array<{ start: number; end: number }>): Array<{
    role: string
    span: { start: number; end: number }
  }>
  
  /**
   * Optional: continuation hook for chained macros.
   * 
   * Called when the next sibling is a potential continuation (e.g., @else_if
   * after @if). Return the continuation data to merge, or null to stop.
   */
  continue?(next: { name: string; head: TokenStream }): THead | null
}

// ============================================================================
// Macro registry
// ============================================================================

/** Registry of macro components by name */
const macroRegistry = new Map<string, MacroComponent<any>>()

/** Register a macro component */
export function registerMacro(name: string, macro: MacroComponent<any>): void {
  macroRegistry.set(name, macro)
}

/** Look up a registered macro by name */
export function getMacro(name: string): MacroComponent<any> | undefined {
  return macroRegistry.get(name)
}

/** Check if a macro is registered */
export function hasMacro(name: string): boolean {
  return macroRegistry.has(name)
}

/** Get all registered macro names */
export function getMacroNames(): string[] {
  return Array.from(macroRegistry.keys())
}
