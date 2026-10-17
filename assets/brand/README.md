# TSDML brand assets

The mark is the DML template block itself — braces around a value:

```
{ • }        div { @class: "hi", { count.read() } }
```

[`tsdml.svg`](./tsdml.svg) · [`tsdml-dark.svg`](./tsdml-dark.svg) — one flat
glyph, no background plate and no lettering, so it stays legible at 18px where a
badge or a wordmark turns to mush.

## Variants are recolors

Both files are the *same geometry and the same color*; a variant only swaps the
two color values (`stroke` on the braces, `fill` on the dot) — like the icon
variants in VS Code's Material Icon Theme.

| file | color | for |
| --- | --- | --- |
| [`tsdml.svg`](./tsdml.svg) | `#aa3bff` (light accent) | light surfaces |
| [`tsdml-dark.svg`](./tsdml-dark.svg) | `#c084fc` (dark accent) | dark surfaces |

Those two values are exactly the demo app's `--accent` in its light and dark
theme, so the mark always matches the accent it sits next to.

```bash
# a new recolor, nothing else
sed 's/#aa3bff/#0ea5e9/g' tsdml.svg > tsdml-sky.svg
```

## Check a change

Open [`preview.html`](./preview.html) in a browser: both files at the sizes the
demo app actually uses (28px hero, 18px link), on light and dark backgrounds.
Note that an XML comment may not contain `--` — that breaks the file silently.
