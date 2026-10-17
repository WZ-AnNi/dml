/**
 * Compiler capability probes.
 *
 * The extension ships `@tsdml/compiler` (a native `.node`) and that binary is
 * rebuilt often — after every language change. A **running** extension host
 * keeps the image it mapped at load time, so after a rebuild the editor can
 * silently execute the *previous* compiler: it mis-parses new syntax and the
 * template then reaches TypeScript as raw DML, which shows up as a storm of
 * syntax errors (TS1005/TS1136/TS18004) that looks like a language bug rather
 * than a stale build.
 *
 * These probes name the features this extension build expects, so `activate`
 * can tell the user to reload the window instead of leaving a mystery.
 */

/** One language feature the extension build depends on. */
export interface FeatureProbe {
  /** Shown in the warning message. */
  what: string
  /** Inner DML text that must parse without errors on a current compiler. */
  source: string
}

export const FEATURE_PROBES: FeatureProbe[] = [
  {
    what: 'control-flow blocks (@if/@for)',
    // `@key` is a body attribute of `@for` (Phase B); the old `.key(x)` head
    // suffix was removed, so probing it would always report "stale".
    source: 'div { @if (a) { span { "x" } }, @for (x of xs) { @key: x.id, li { { x.label } } } }',
  },
  {
    what: 'named slots (@template/@slot)',
    // one template root per compile: `@template` on the caller side fills the
    // `@slot` outlet the component declares
    source: 'Panel { @template("footer") { span { "x" } } }',
  },
  {
    what: 'slot outlets (@slot)',
    source: 'div { @slot("footer") { footer { "y" } } }',
  },
  { what: 'TypeScript value positions', source: 'div { @style: { color: "red" } }' },
]

/** The minimal compiler surface the probe needs. */
export interface ProbeCompiler {
  compileWithSpans(source: string): { errors: unknown[] }
}

/**
 * Features the *loaded* compiler does not understand (empty = up to date).
 *
 * A probe that throws counts as missing: the binding is then unusable, which is
 * worth reporting for the same reason.
 */
export function staleFeatures(
  compiler: ProbeCompiler,
  probes: FeatureProbe[] = FEATURE_PROBES,
): string[] {
  const stale: string[] = []
  for (const probe of probes) {
    try {
      if (compiler.compileWithSpans(probe.source).errors.length > 0) stale.push(probe.what)
    } catch {
      stale.push(probe.what)
    }
  }
  return stale
}
