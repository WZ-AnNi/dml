/**
 * @tsdml/language-service — semantic helpers for TSDML documents.
 *
 * Pure helpers consumed by the VS Code editor features
 * (editors/vscode-tsdml/src/tsdmlEditorFeatures.ts): AST navigation,
 * completion, hover and `.d.ts` model queries for the DML template regions.
 *
 * The TypeScript-server integration no longer lives here: the server plugin
 * (src/tsPlugin.ts) is built on the Volar quickstart architecture
 * (@volar/typescript createLanguageServicePlugin + languagePlugin.ts), the
 * same machinery Vue/Volar uses for `.vue`.
 */
export * from "./semantic.js"
