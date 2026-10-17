import { describe, expect, it } from "vitest"
import { findNode, mount, toText } from "@dml/runtime-test"
import type { TestNode } from "@dml/runtime-test"
import { createCounter } from "../src/counter.tsdml"
import { Panel } from "../src/components/Panel.tsdml"

function makeCounter(): TestNode {
  const container: TestNode = {
    type: "root",
    children: [],
    props: {},
    events: {},
  }
  mount(createCounter(), container as never)
  return container.children[0]!
}

/** A Panel with no `@template("footer")` — the outlet shows its fallback. */
function mountPanelWithoutFooter(): TestNode {
  const container: TestNode = {
    type: "root",
    children: [],
    props: {},
    events: {},
  }
  mount(
    // Panel is a plain function component; calling it with no footer prop
    // exercises the `props.footer ?? fallback` branch directly.
    Panel({ title: "bare" }) as never,
    container as never,
  )
  return container.children[0]!
}

/** Click the counter button (drives the component's internal signal). */
function clickCounter(root: TestNode): void {
  const button = findNode(root, (n) => n.type === "button")!
  const handler = button.events["onClick"] as () => void
  handler()
}

/** The placeholder text node the `{ count.read() }` binding patches in place. */
function reactiveText(root: TestNode): TestNode {
  const button = findNode(root, (n) => n.type === "button")!
  const texts = button.children.filter((c) => c.type === "text")
  return texts[texts.length - 1]!
}

describe("@dml/example-tsdml-counter (TSDML template -> reactive runtime)", () => {
  it("renders the full page structure", () => {
    const root = makeCounter()

    // root wrapper is display:contents
    expect(root.type).toBe("div")
    expect(root.props["class"]).toBe("page-root")

    // hero section
    const center = findNode(root, (n) => n.props["id"] === "center")!
    expect(center.type).toBe("section")
    const hero = findNode(center, (n) => n.props["class"] === "hero")!
    const imgs = hero.children.filter((c) => c.type === "img")
    expect(imgs).toHaveLength(3)
    expect(imgs[0]!.props["class"]).toBe("base")
    expect(imgs[1]!.props["class"]).toBe("framework")
    expect(imgs[2]!.props["class"]).toBe("vite")

    // heading + paragraph
    const h1 = findNode(center, (n) => n.type === "h1")!
    expect(toText(h1)).toBe("Get started")

    // counter button
    const button = findNode(center, (n) => n.type === "button")!
    expect(button.props["class"]).toBe("counter")
    expect(button.props["type"]).toBe("button")
    expect(button.events["onClick"]).toBeTypeOf("function")

    // next-steps sections
    const nextSteps = findNode(root, (n) => n.props["id"] === "next-steps")!
    expect(nextSteps.type).toBe("section")
    expect(findNode(nextSteps, (n) => n.props["id"] === "docs")).toBeDefined()
    expect(findNode(nextSteps, (n) => n.props["id"] === "social")).toBeDefined()

    // spacer
    expect(findNode(root, (n) => n.props["id"] === "spacer")).toBeDefined()
  })

  it("re-renders only the bound text node when the signal changes", () => {
    const root = makeCounter()
    const textNode = reactiveText(root)

    clickCounter(root) // 0 -> 1
    expect(textNode.text).toBe("1")

    clickCounter(root) // 1 -> 2
    expect(textNode.text).toBe("2")

    // in-place patch: the button still has exactly one reactive text child
    const button = findNode(root, (n) => n.type === "button")!
    expect(button.children.filter((c) => c.type === "text")).toHaveLength(2)
  })

  it("wires the onClick handler from the template to mutate state", () => {
    const root = makeCounter()
    const button = findNode(root, (n) => n.type === "button")!
    const textNode = reactiveText(root)

    clickCounter(root)
    expect(textNode.text).toBe("1")
    expect(button.events["onClick"]).toBeTypeOf("function")
  })

  it("keeps the static structure shared: no props object per render", () => {
    const root = makeCounter()
    // the static skeleton comes from the hoisted shape (cloned), so static
    // attributes are already present without any binding code running
    const hero = findNode(root, (n) => n.props["class"] === "hero")!
    const imgs = hero.children.filter((c) => c.type === "img")
    expect(imgs[0]!.props["width"]).toBe(170)
    expect(imgs[0]!.props["alt"]).toBe("")
  })

  it("renders a nested component (Badge) with its props", () => {
    const root = makeCounter()
    const badge = findNode(root, (n) => n.type === "span" && n.props["class"] === "green")
    expect(badge).toBeDefined()
    expect(toText(badge)).toBe("TSDML")
  })

  it("evaluates TS expressions in value position (props.tone ?? 'badge')", () => {
    const root = makeCounter()
    // the second Badge gets no `tone`, so the `??` fallback must kick in —
    // proof that the value was compiled as an expression, not a string
    const badge = findNode(
      root,
      (n) => n.type === "span" && n.props["class"] === "badge",
    )
    expect(badge).toBeDefined()
    expect(toText(badge)).toBe("no tone")
  })

  it("passes children through a component (Panel)", () => {
    const root = makeCounter()
    const panel = findNode(root, (n) => n.props["class"] === "panel")
    expect(panel).toBeDefined()
    const heading = findNode(panel, (n) => n.type === "h2")
    expect(toText(heading)).toBe("Counter demo")

    // the caller's children landed inside the panel body: the Badge and the
    // reactive button are panel children, not siblings of the section
    const body = findNode(panel, (n) => n.props["class"] === "panel-body")!
    expect(findNode(body, (n) => n.type === "button")).toBeDefined()
    expect(findNode(body, (n) => n.type === "span" && n.props["class"] === "green")).toBeDefined()
  })

  it("keeps a component's reactive child live through the panel", () => {
    const root = makeCounter()
    const textNode = reactiveText(root)
    clickCounter(root)
    expect(textNode.text).toBe("1")
  })

  it("@if mounts and unmounts the element with the condition", () => {
    const root = makeCounter()
    expect(findNode(root, (n) => n.props["class"] === "hot")).toBeUndefined()

    clickCounter(root) // 1
    clickCounter(root) // 2
    expect(findNode(root, (n) => n.props["class"] === "hot")).toBeUndefined()

    clickCounter(root) // 3 → condition holds
    const hot = findNode(root, (n) => n.props["class"] === "hot")
    expect(hot).toBeDefined()
    expect(toText(hot)).toBe("hot!")
  })

  it("@for renders the list and reuses keyed nodes", () => {
    const root = makeCounter()
    clickCounter(root)
    clickCounter(root)

    const tickList = () => findNode(root, (n) => n.props["class"] === "tick-list")!
    const items = () => collect(tickList(), (n) => n.type === "li")
    expect(items().map(toText)).toEqual(["tick 1", "tick 2"])

    // remember the node identity of the first item…
    const first = findNode(tickList(), (n) => n.type === "li" && toText(n) === "tick 1")!

    clickCounter(root) // add a third item
    expect(items().map(toText)).toEqual(["tick 1", "tick 2", "tick 3"])
    // …it must be the SAME node: `@key` reused it instead of rebuilding
    expect(findNode(tickList(), (n) => n.type === "li" && toText(n) === "tick 1")).toBe(first)
  })

  it("@slot routes the element into the component's named slot", () => {
    const root = makeCounter()
    // the caller's `@template("footer")` replaces the whole outlet body, so
    // the note is a direct child of the panel (where the outlet sits)
    const panel = findNode(root, (n) => n.props["class"] === "panel")!
    const note = findNode(panel, (n) => n.props["class"] === "footer-note")
    expect(note).toBeDefined()
    expect(toText(note)).toBe("panel footer")
    // and it is NOT a positional child of the panel body
    const body = findNode(root, (n) => n.props["class"] === "panel-body")!
    expect(findNode(body, (n) => n.props["class"] === "footer-note")).toBeUndefined()
    // the fallback footer was replaced, not rendered alongside
    expect(findNode(panel, (n) => n.props["class"] === "panel-footer")).toBeUndefined()
  })

  it("@slot falls back when the caller passes nothing", () => {
    // a panel with no `@template("footer")` renders its fallback
    const root = mountPanelWithoutFooter()
    const panel = findNode(root, (n) => n.props["class"] === "panel")!
    const footer = findNode(panel, (n) => n.props["class"] === "panel-footer")!
    expect(toText(footer)).toBe("no footer")
  })
})

/** Every node matching `pred`, depth-first (list assertions). */
function collect(node: unknown, pred: (n: TestNode) => boolean): TestNode[] {
  const out: TestNode[] = []
  const walk = (n: unknown) => {
    if (n == null || typeof n !== "object") return
    if (Array.isArray(n)) return n.forEach(walk)
    const test = n as TestNode
    if (test.type !== "text" && pred(test)) out.push(test)
    for (const child of test.children ?? []) walk(child)
  }
  walk(node)
  return out
}
