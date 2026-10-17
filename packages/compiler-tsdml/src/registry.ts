/**
 * Macro component registry.
 * 
 * This is the central registry for all macro components (built-in and user-defined).
 * The compiler calls into this registry when it encounters @name(...) syntax.
 */

import type { MacroComponent, MacroContext, IrExpr } from "./macro-types.js"
import { registerBuiltins } from "./builtins.js"

// Global registry
const registry = new Map<string, MacroComponent<any>>()

/**
 * Register a macro component.
 */
export function registerMacro(name: string, macro: MacroComponent<any>): void {
  registry.set(name, macro)
}

/**
 * Get a registered macro by name.
 */
export function getMacro(name: string): MacroComponent<any> | undefined {
  return registry.get(name)
}

/**
 * Check if a macro is registered.
 */
export function hasMacro(name: string): boolean {
  return registry.has(name)
}

/**
 * Initialize the registry with built-in macros.
 * Called automatically when the compiler loads.
 */
export function initRegistry(): void {
  registerBuiltins(registerMacro)
}

// Auto-initialize on import
initRegistry()

/**
 * Process a macro call from the compiler.
 * 
 * This is the entry point called by the Rust codegen when it encounters
 * __dml_macro__("name", "headSrc", [...body]) markers.
 * 
 * @param name - Macro name (e.g., "if", "for", "Show")
 * @param headSrc - Raw source text inside the (...) head
 * @param body - Body members (as DML AST JSON)
 * @param ctx - Compilation context
 * @returns IrExpr to be compiled to backend output
 */
export function processMacroCall(
  name: string,
  headSrc: string,
  body: unknown[],
  ctx: MacroContext
): IrExpr {
  const macro = getMacro(name)
  
  if (!macro) {
    ctx.error(`Unknown macro component: @${name}`)
    return { type: "null" }
  }
  
  // Parse the head
  const { TokenStreamImpl } = require("./token-stream.js")
  const stream = new TokenStreamImpl(headSrc)
  const parsedHead = macro.parse(stream)
  
  // Generate IR
  return macro.generate(parsedHead, body, ctx)
}
