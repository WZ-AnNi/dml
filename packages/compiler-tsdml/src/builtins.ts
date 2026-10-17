/**
 * Built-in macro components: @if, @for.
 *
 * These are registered at compiler startup and available globally without import.
 * They directly produce optimized IR nodes (cond/map/keyedMap) rather than going
 * through the generic macro path.
 */

import type { MacroComponent, MacroContext, IrExpr, Token } from "./macro-types.js"
import { T_ELSE_IF, T_ELSE, T_OF, T_IN } from "./macro-types.js"
import { TokenStreamImpl } from "./token-stream.js"

// ============================================================================
// @if macro
// ============================================================================

interface IfHead {
  cond: string
}

interface IfContinuation {
  type: "else_if" | "else"
  cond: string | null
  body: unknown[]
}

export const IfMacro: MacroComponent<IfHead> = {
  parse(head) {
    const stream = new TokenStreamImpl(head)
    const cond = stream.parseExpression()
    return { cond }
  },
  
  generate(head, body, ctx) {
    // Build cond node with first branch
    const branches: Array<{ cond: string | null; body: IrExpr[] }> = [
      { cond: head.cond, body: ctx.compileBody(body) }
    ]
    
    return {
      type: "cond",
      cond: head.cond,
      branches
    }
  },
  
  continue(next) {
    // Check if next is @else_if or @else
    if (next.name === "else_if") {
      const stream = new TokenStreamImpl(next.head.rest())
      const cond = stream.parseExpression()
      return { cond, type: "else_if" } as any
    }
    
    if (next.name === "else") {
      return { cond: null, type: "else" } as any
    }
    
    return null
  }
}

// ============================================================================
// @for macro
// ============================================================================

interface ForHead {
  binding: string
  iter: string
  key?: string
}

export const ForMacro: MacroComponent<ForHead> = {
  parse(head) {
    const stream = new TokenStreamImpl(head)
    
    // Parse binding (identifier or destructuring)
    const binding = stream.parseBinding()
    
    // Expect 'of' or 'in' keyword
    const kw = stream.peek()
    if (kw.type === "keyword" && (kw.value === "of" || kw.value === "in")) {
      stream.next()
    }
    
    // Parse iterable expression
    const iter = stream.parseExpression()
    
    // Check for .key() modifier
    let key: string | undefined
    const rest = stream.rest().trim()
    if (rest.startsWith(".key(")) {
      const match = rest.match(/\.key\(([^)]+)\)/)
      if (match) {
        key = match[1]
      }
    }
    
    return { binding, iter, key }
  },
  
  generate(head, body, ctx) {
    const children = ctx.compileBody(body)
    
    if (head.key) {
      return {
        type: "keyedMap",
        binding: head.binding,
        iter: head.iter,
        key: head.key,
        body: children
      }
    }
    
    return {
      type: "map",
      binding: head.binding,
      iter: head.iter,
      body: children
    }
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerBuiltins(register: (name: string, macro: MacroComponent<any>) => void) {
  register("if", IfMacro)
  register("for", ForMacro)
}
