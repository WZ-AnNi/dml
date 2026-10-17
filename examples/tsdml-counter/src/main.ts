/**
 * TSDML counter — browser entry.
 *
 * Mounts the `.tsdml` component into `#root`. The component takes no renderer:
 * the compiled template imports the DOM host runtime itself, so the entry point
 * is just "build the component, mount it". The same `createCounter` source is
 * exercised against the in-memory test host in `test/counter.spec.ts`.
 */

import { mount } from "@dml/runtime-dom";
import "./App.css";
import { createCounter } from "./counter.tsdml";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

mount(createCounter(), container!);
