import { defineConfig } from "vitest/config"
import { tsdml } from "@tsdml/vite"

// The same `.tsdml` sources are built against the in-memory test host: the
// compiler imports its runtime primitives from `@dml/runtime-test` instead of
// `@dml/runtime-dom`, so no renderer argument ever reaches component code.
export default defineConfig({
  plugins: [tsdml({ runtimeModule: "@dml/runtime-test" })],
  test: {
    environment: "node",
  },
})
