# DML / TSDML Language Support

Language support for **DML** and **TSDML** in Visual Studio Code, powered by a
native Rust language server (`dml-lsp`) that reuses the same parser as the
`@tsdml/compiler` — so editor diagnostics always match what the compiler reports.

## Features

- **Syntax highlighting** (TextMate grammar) for `.dml` and `.tsdml`
- **Diagnostics** — parse errors with exact position, from the Rust parser
- **Hover** — element / attribute info
- **Semantic tokens** — element names, attributes, strings, numbers, expressions
- **Completion** — element and attribute suggestions
- **Full TypeScript integration for `.tsdml`** — a TypeScript language-service
  plugin (`@tsdml/language-service`) is registered via
  `contributes.typescriptServerPlugins`. It lowers every `@{ ... }` template
  block into `e(...)` calls on the fly, so `.tsdml` files get real
  type-checking, autocomplete, hover and go-to-definition for both the TS code
  and the identifiers used inside templates — exactly like TSX, with **no
  hand-written `.d.ts` files**.

## Requirements

- Visual Studio Code 1.85+
- The bundled `dml-lsp` binary (Windows x64) is included in this package.
- For `.tsdml` TypeScript integration, install `@tsdml/language-service` in
  your project (it is loaded by the TS server from `node_modules`):

  ```sh
  pnpm add -D @tsdml/language-service
  ```

## Usage

Open a `.dml` or `.tsdml` file. The extension spawns the language server
automatically.

To use a custom `dml-lsp` binary, set `dml.lsp.path` in your settings.

## Building the language server

The server is built from the monorepo at `packages/compiler-tsdml`:

```sh
cargo build -p dml-lsp --release
```

## License

MIT
