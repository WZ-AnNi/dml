import { describe, expect, it } from "vitest";
import { createTestRenderer } from "../src/index.js";
import type { TestNode } from "../src/index.js";

describe("@dml/runtime-test (in-memory host)", () => {
  it("renders DOM-host-agnostic runtime-core output into plain objects", () => {
    const r = createTestRenderer();

    const root = r.createElement(
      "div",
      { class: "app" },
      [
        r.createText("hi"),
        r.createElement("p", { id: "x" }, r.createText("hello")),
      ],
    );

    const container = r.createElement("div", null, []);
    r.mount(root, container);

    const node = container as unknown as TestNode;
    const div = node.children[0]! as TestNode;
    expect(div.type).toBe("div");
    expect(div.props["class"]).toBe("app");
    expect(div.children[0]!.type).toBe("text");
    expect(div.children[0]!.text).toBe("hi");
    const p = div.children[1]! as TestNode;
    expect(p.type).toBe("p");
    expect(p.children[0]!.text).toBe("hello");
  });

  it("patch updates a single property (fine-grained)", () => {
    const r = createTestRenderer();
    const el = r.createElement("button", { class: "a" }, []);
    r.patch(el, "class", "a", "b");
    expect((el as unknown as TestNode).props["class"]).toBe("b");
    r.patch(el, "aria-label", undefined, "ok");
    expect((el as unknown as TestNode).props["aria-label"]).toBe("ok");
  });

  it("events are bound via patchProp", () => {
    const r = createTestRenderer();
    const el = r.createElement("button", null, []);
    const handler = () => 42;
    r.patch(el, "onClick", undefined, handler);
    const node = el as unknown as TestNode;
    expect(typeof node.events["onClick"]).toBe("function");
  });
});
