import { tsdml } from "@tsdml/vite";
import { DevTools } from "@vitejs/devtools";
import { defineConfig } from "vite";
import inspect from "vite-plugin-inspect";

export default defineConfig({
	devtools: true,
	plugins: [DevTools(), inspect(), tsdml()],
});
