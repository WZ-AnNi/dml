import { describe, expect, it } from "vitest"
import { loadDmlConfig, elementToConfig } from "../src/index.js"

describe("@dml/cli (DML as configuration)", () => {
  it("converts attributes, children, sequences and namespaces to a config object", () => {
    const source = `
      project {
        @name: "demo"
        @version: 1
        include: [ "a", "b" ]
        tasks {
          build: "pnpm build"
          "build:napi": "pnpm build:napi"
        }
        registry {
          @scope: "@dml"
          aliases: { runtime: "@dml/runtime-core" }
        }
      }
    `
    const cfg = loadDmlConfig(source)
    expect(cfg["name"]).toBe("demo")
    expect(cfg["version"]).toBe(1)
    expect(cfg["include"]).toEqual(["a", "b"])
    expect(cfg["tasks"]).toEqual({
      build: "pnpm build",
      "build:napi": "pnpm build:napi",
    })
    expect(cfg["registry"]).toEqual({
      scope: "@dml",
      aliases: { runtime: "@dml/runtime-core" },
    })
  })

  it("repeated child elements become arrays", () => {
    const source = `
      list {
        item { @id: 1 }
        item { @id: 2 }
      }
    `
    const cfg = loadDmlConfig(source)
    expect(cfg["item"]).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("elementToConfig handles bare and boolean values", () => {
    const source = `el { @a: none, @b: true, @c: null }`
    const cfg = loadDmlConfig(source)
    expect(cfg["a"]).toBe("none")
    expect(cfg["b"]).toBe(true)
    expect(cfg["c"]).toBeNull()
  })
})
