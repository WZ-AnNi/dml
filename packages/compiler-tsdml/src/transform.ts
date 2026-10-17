/**
 * Macro transform: processes __dml_macro__ calls in generated code.
 * 
 * This transform is called by the build pipeline after Rust codegen.
 * It intercepts __dml_macro__("name", "headSrc", [...body]) calls and
 * replaces them with the actual compiled output from the registered macro.
 */

import { getMacro } from "./registry.js"
import type { MacroContext, IrExpr } from "./macro-types.js"
import { TokenStreamImpl } from "./token-stream.js"

/**
 * Compile IrExpr to backend code.
 * 
 * This is a simplified version that generates runtime calls.
 * The actual implementation would integrate with the Rust codegen backends.
 */
function compileIrExpr(ir: IrExpr): string {
  switch (ir.type) {
    case "cond":
      // Generate conditional rendering
      const branches = ir.branches.map((b, i) => {
        const cond = b.cond || "true"
        const body = b.body.map(compileIrExpr).join(", ")
        return i === 0 ? `(${cond}) ? [${body}]` : `: (${cond}) ? [${body}]`
      }).join(" ")
      return `${branches} : []`
    
    case "map":
      // Generate unkeyed loop
      const mapBody = ir.body.map(compileIrExpr).join(", ")
      return `(${ir.iter}).map((${ir.binding}) => [${mapBody}])`
    
    case "keyedMap":
      // Generate keyed loop
      const keyedBody = ir.body.map(compileIrExpr).join(", ")
      return `(${ir.iter}).map((${ir.binding}) => [${keyedBody}])`
    
    case "element":
      const attrs = ir.attrs.map(a => `${a.name}: ${a.value || "true"}`).join(", ")
      const children = ir.children.map(compileIrExpr).join(", ")
      return `e("${ir.tag}", { ${attrs} }, [${children}])`
    
    case "expr":
      return `() => ${ir.expr}`
    
    case "text":
      return JSON.stringify(ir.text)
    
    case "array":
      return `[${ir.items.map(compileIrExpr).join(", ")}]`
    
    case "component":
      const props = ir.props.map(p => `${p.name}: ${p.value}`).join(", ")
      const compChildren = ir.children.map(compileIrExpr).join(", ")
      return `${ir.name}({ ${props} }, [${compChildren}])`
    
    case "raw":
      return ir.code
    
    case "null":
      return "null"
    
    default:
      return "null"
  }
}

/**
 * Parse body items from the Rust-generated array string.
 * The body is already compiled by Rust as code snippets.
 */
function parseBodyArray(bodyStr: string): string[] {
  if (!bodyStr.trim()) return []
  
  // Simple parsing: split by top-level commas
  // This is a simplified version - real implementation needs proper bracket matching
  const items: string[] = []
  let current = ''
  let depth = 0
  
  for (let i = 0; i < bodyStr.length; i++) {
    const ch = bodyStr[i]
    
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      current += ch
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  
  if (current.trim()) {
    items.push(current.trim())
  }
  
  return items
}

/**
 * Create a macro compilation context.
 */
function createMacroContext(errors: string[], bodyItems: string[]): MacroContext {
  return {
    compileBody(members: unknown[]): IrExpr[] {
      // Body items are already compiled by Rust as code strings
      // Wrap each as a raw IrExpr
      return bodyItems.map(code => ({
        type: 'raw',
        code
      }))
    },
    
    error(message: string, span?: { start: number; end: number }) {
      errors.push(span ? `${message} at ${span.start}-${span.end}` : message)
    }
  }
}

/**
 * Transform generated code by processing __dml_macro__ calls.
 * 
 * @param code - Generated code from Rust codegen
 * @returns Transformed code with macro calls replaced by actual output
 */
export function transformMacros(code: string): { code: string; errors: string[] } {
  const errors: string[] = []
  
  // Match __dml_macro__("name", "headSrc", [...]) calls
  const macroCallRegex = /__dml_macro__\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*\[([^\]]*)\]\s*\)/g
  
  const transformed = code.replace(macroCallRegex, (match, name, headSrc, bodyStr) => {
    const macro = getMacro(name)
    
    if (!macro) {
      errors.push(`Unknown macro component: @${name}`)
      return "null"
    }
    
    try {
      // Parse the head
      const stream = new TokenStreamImpl(headSrc)
      const parsedHead = macro.parse(stream)
      
      // Body is already compiled by Rust as an array of code snippets
      // Parse the body string to extract individual items
      const bodyItems = parseBodyArray(bodyStr)
      
      // Create context
      const ctx = createMacroContext(errors, bodyItems)
      
      // Generate IR
      const ir = macro.generate(parsedHead, bodyItems, ctx)
      
      // Compile to backend code
      return compileIrExpr(ir)
    } catch (err) {
      errors.push(`Error processing @${name}: ${err}`)
      return "null"
    }
  })
  
  return { code: transformed, errors }
}
