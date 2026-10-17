/**
 * TokenStream implementation for macro head parsing.
 * 
 * Tokenizes the head source string and provides structured access methods.
 */

import type { Token, TokenType, TokenStream } from "./macro-types.js"

/** Simple tokenizer for TypeScript expressions */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  
  while (pos < source.length) {
    const start = pos
    const ch = source[pos]
    
    // Whitespace
    if (/\s/.test(ch)) {
      while (pos < source.length && /\s/.test(source[pos])) pos++
      tokens.push({ type: "whitespace", value: source.slice(start, pos), start, end: pos })
      continue
    }
    
    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      pos++
      while (pos < source.length && source[pos] !== quote) {
        if (source[pos] === '\\') pos++ // skip escaped char
        pos++
      }
      pos++ // closing quote
      tokens.push({ type: "string", value: source.slice(start, pos), start, end: pos })
      continue
    }
    
    // Numbers
    if (/[0-9]/.test(ch)) {
      while (pos < source.length && /[0-9.]/.test(source[pos])) pos++
      tokens.push({ type: "number", value: source.slice(start, pos), start, end: pos })
      continue
    }
    
    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      while (pos < source.length && /[a-zA-Z0-9_$]/.test(source[pos])) pos++
      const value = source.slice(start, pos)
      const type: TokenType = ["of", "in", "else", "if"].includes(value) ? "keyword" : "identifier"
      tokens.push({ type, value, start, end: pos })
      continue
    }
    
    // Punctuation
    if (/[(){}\[\],.;:]/.test(ch)) {
      pos++
      tokens.push({ type: "punctuation", value: ch, start, end: pos })
      continue
    }
    
    // Operators
    if (/[+\-*/%=<>!&|^~?]/.test(ch)) {
      // Handle multi-char operators
      while (pos < source.length && /[+\-*/%=<>!&|^~?]/.test(source[pos])) pos++
      tokens.push({ type: "operator", value: source.slice(start, pos), start, end: pos })
      continue
    }
    
    // Unknown - skip
    pos++
  }
  
  tokens.push({ type: "eof", value: "", start: pos, end: pos })
  return tokens
}

/** TokenStream implementation */
export class TokenStreamImpl implements TokenStream {
  private tokens: Token[]
  private pos: number = 0
  private source: string
  
  constructor(source: string) {
    this.source = source
    this.tokens = tokenize(source)
    // Skip leading whitespace
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === "whitespace") {
      this.pos++
    }
  }
  
  peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "", start: this.source.length, end: this.source.length }
  }
  
  next(): Token {
    const token = this.peek()
    this.pos++
    // Skip whitespace after consuming
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === "whitespace") {
      this.pos++
    }
    return token
  }
  
  tryConsume(expected: Token): boolean {
    const current = this.peek()
    if (current.type === expected.type && current.value === expected.value) {
      this.next()
      return true
    }
    return false
  }
  
  parseExpression(): string {
    // Collect tokens until we hit a keyword or eof
    const parts: string[] = []
    let depth = 0
    
    while (!this.eof()) {
      const token = this.peek()
      
      // Stop at keywords at depth 0
      if (depth === 0 && token.type === "keyword") {
        break
      }
      
      // Track nesting depth
      if (token.type === "punctuation") {
        if (token.value === "(" || token.value === "[" || token.value === "{") {
          depth++
        } else if (token.value === ")" || token.value === "]" || token.value === "}") {
          if (depth === 0) break
          depth--
        }
      }
      
      parts.push(token.value)
      this.next()
    }
    
    return parts.join("").trim()
  }
  
  parseBinding(): string {
    // Parse identifier or destructuring pattern
    const token = this.peek()
    
    // Destructuring pattern
    if (token.type === "punctuation" && (token.value === "{" || token.value === "[")) {
      const parts: string[] = []
      let depth = 0
      
      while (!this.eof()) {
        const t = this.peek()
        if (t.type === "punctuation") {
          if (t.value === "{" || t.value === "[") depth++
          else if (t.value === "}" || t.value === "]") {
            depth--
            if (depth === 0) {
              parts.push(t.value)
              this.next()
              break
            }
          }
        }
        parts.push(t.value)
        this.next()
      }
      
      return parts.join("").trim()
    }
    
    // Simple identifier
    if (token.type === "identifier") {
      this.next()
      return token.value
    }
    
    return ""
  }
  
  eof(): boolean {
    return this.peek().type === "eof"
  }
  
  rest(): string {
    const current = this.peek()
    return this.source.slice(current.start)
  }
}
