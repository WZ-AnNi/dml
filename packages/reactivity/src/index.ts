/**
 * @dml/reactivity
 *
 * Framework-friendly reactive primitives backed by `alien-signals`
 * (the same signal core Vue's reactivity is ported from).
 *
 * Responsibility of this package:
 *   - Own the single source of truth for reactivity primitives used by
 *     runtime-core / runtime-dom and framework users.
 *   - Wrap alien-signals in DML-idiomatic helpers, without leaking framework
 *     concerns (no DOM, no rendering here).
 *
 * Dependency: alien-signals >= 3.x (installed at latest).
 */

export {
  signal,
  computed,
  effect,
  effectScope,
  trigger,
  startBatch,
  endBatch,
  getActiveSub,
  setActiveSub,
  getBatchDepth,
  isSignal,
  isComputed,
  isEffect,
  isEffectScope,
} from "alien-signals"

import {
  signal as alienSignal,
  effect as alienEffect,
  computed as alienComputed,
  effectScope as alienEffectScope,
} from "alien-signals"

/** A read/write signal: callable `s()` reads, `s(v)` writes. */
export type Signal<T> = (() => T) & ((value: T) => void)
export type ReadSignal<T> = () => T
export type WriteSignal<T> = (value: T) => void

export interface SignalPair<T> {
  read: ReadSignal<T>
  write: WriteSignal<T>
  ref: Signal<T>
}

/**
 * createSignal — wrap alien-signals `signal()` into an explicit pair plus the
 * raw ref, matching our framework API (read/write separated) as documented in
 * DML-Framework.md §6.
 */
export function createSignal<T>(): SignalPair<T | undefined>
export function createSignal<T>(initial: T): SignalPair<T>
export function createSignal<T>(initial?: T): SignalPair<T | undefined> {
  const s = alienSignal<T | undefined>(initial) as Signal<T | undefined>
  return {
    read: s as ReadSignal<T | undefined>,
    write: s as WriteSignal<T | undefined>,
    ref: s,
  }
}

/** Derived reactive value. */
export function createComputed<T>(fn: () => T): () => T {
  return alienComputed(fn)
}

/**
 * Subscribe to reactive state and rerun when any tracked dependency changes.
 * Returns a disposer. The effect body may return a cleanup function.
 */
export function createEffect(fn: () => void | (() => void)): () => void {
  return alienEffect(fn)
}

/** Run `fn` inside a new effect scope; returns the scope disposer. */
export function createEffectScope(fn: () => void): () => void {
  return alienEffectScope(fn)
}