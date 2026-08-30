/**
 * dml — CLI bin entry.
 *
 *   dml convert <file.dml>      interpret a DML document as config → JSON
 *   dml compile <file.dml>      DML source → framework runtime-call code
 *   dml parse   <file.dml>      DML source → AST JSON (debug)
 */

import { readFileSync } from "node:fs"
import { parse, compile } from "@tsdml/compiler"
import { loadDmlConfig } from "./index.js"

function fail(message: string): never {
  console.error(`dml: ${message}`)
  process.exit(1)
}

function main(): void {
  const [cmd, file] = process.argv.slice(2)
  if (!cmd || !file) {
    console.log(
      "usage: dml <convert|compile|parse> <file.dml>",
    )
    process.exit(0)
  }
  let source: string
  try {
    source = readFileSync(file, "utf-8")
  } catch (e) {
    fail(`cannot read ${file}: ${(e as Error).message}`)
  }

  switch (cmd) {
    case "convert": {
      const config = loadDmlConfig(source)
      console.log(JSON.stringify(config, null, 2))
      break
    }
    case "compile": {
      const code = compile(source)
      console.log(code)
      break
    }
    case "parse": {
      const ast = parse(source)
      console.log(JSON.stringify(ast, null, 2))
      break
    }
    default:
      fail(`unknown command "${cmd}"`)
  }
}

main()