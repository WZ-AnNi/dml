/**
 * TSDML TypeScript-server plugin entry — Volar quickstart architecture.
 *
 * Bundled by scripts/build.mjs into `node_modules/tsdml-tsplugin/index.js`
 * with `@tsdml/language-service` and `@volar/typescript` left external.
 * tsserver probes the extension's own node_modules, requires this module, and
 * expects the module ITSELF to be the plugin factory.
 *
 * createLanguageServicePlugin (from @volar/typescript, the same machinery
 * Vue's language-tools uses) wires our `.tsdml` LanguagePlugin into the TS
 * server: it registers `.tsdml` as an extra file extension, decorates the
 * project host so `.tsdml` files are picked up and served as lowered TS, and
 * reports every `.tsdml` via getExternalFiles — which is what makes
 * `import "./counter.tsdml"` in a plain `.ts` file resolve without TS2307,
 * exactly like `import "./App.vue"` does under Vue/Volar.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createLanguageServicePlugin } = require('@volar/typescript/lib/quickstart/createLanguageServicePlugin')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tsdmlLanguagePlugin } = require('./languagePlugin')

module.exports = createLanguageServicePlugin((_ts, _info) => ({
	languagePlugins: [tsdmlLanguagePlugin],
}))
