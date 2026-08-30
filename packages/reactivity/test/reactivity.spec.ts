import { describe, expect, it } from "vitest"
import {
  createSignal,
  createComputed,
  createEffect,
  createEffectScope,
  signal,
  computed,
  effect,
} from "../src/index.js"

describe("@dml/reactivity (alien-signals wrapper)", () => {
  it("createSignal exposes read/write/ref", () => {
    const s = createSignal(10)
    expect(s.read()).toBe(10)
    s.write(20)
    expect(s.read()).toBe(20)
    expect(s.ref()).toBe(20)
  })

  it("createSignal without initial is undefined", () => {
    const s = createSignal<number>()
    expect(s.read()).toBeUndefined()
  })

  it("createComputed derives and caches", () => {
    const a = createSignal(2)
    const b = createComputed(() => a.read() * 3)
    expect(b()).toBe(6)
    a.write(5)
    expect(b()).toBe(15)
  })

  it("createEffect reruns on dependency change and returns disposer", () => {
    const s = createSignal(0)
    let runs = 0
    const dispose = createEffect(() => {
      s.read()
      runs++
    })
    expect(runs).toBe(1) // runs immediately
    s.write(1)
    expect(runs).toBe(2)
    dispose()
    s.write(2)
    expect(runs).toBe(2) // no more runs after dispose
  })

  it("createEffectScope isolates effects", () => {
    const s = createSignal(0)
    let runs = 0
    const disposeScope = createEffectScope(() => {
      createEffect(() => {
        s.read()
        runs++
      })
    })
    expect(runs).toBe(1)
    s.write(1)
    expect(runs).toBe(2)
    disposeScope()
    s.write(2)
    expect(runs).toBe(2)
  })

  it("re-exports alien-signals primitives", () => {
    expect(typeof signal).toBe("function")
    expect(typeof computed).toBe("function")
    expect(typeof effect).toBe("function")
  })
})
