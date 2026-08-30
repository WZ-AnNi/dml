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

## Requirements

- Visual Studio Code 1.85+
- The bundled `dml-lsp` binary (Windows x64) is included in this package.

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
