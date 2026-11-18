// The digital waterfall's ⚙ strip: how SHARP the picture is, as four independent choices.
//
// WHY (operator request, 2026-11: the waterfall is "very mixed, averaged, not sharp" beside an
// Icom or Yaesu scope, which is what an operator without a rig screen or a second monitor is
// comparing it with). Three softeners stack in the shipped picture, each one a deliberate, dated
// decision that is right for somebody, so none of them is flipped here. Each becomes a choice whose
// default is today's behaviour:
//
//   resolution  the analysis window the producer runs (rxdsp `compute_row_at`): the Hann main lobe
//               a carrier is drawn as, 47 / 23 / 12 Hz. `sharp` also doubles the row's bins.
//   smoothing   what one drawn row is of the ~6 FFT frames published since the last read
//               (engine `RowSmoothing`): their power mean, their maximum, or the newest alone.
//   edges       how a bin wider than a pixel is filled when zoomed in (aggregate.ts
//               `Interpolation`): blended between bin centres, or held flat to its edges.
//   speed       the row cadence, relative to the surface's own (`rowMs`).
//
// RIG is the four that together give a rig scope's look: one FFT per row, the narrow lobe, hard
// bin edges and a faster sweep. It is a preset, not a mode: it writes the four values and the
// operator can move any of them afterwards.
//
// APP-WIDE, not per surface, because `resolution` is a request to the ONE producer every audio
// waterfall reads: two waterfalls asking for different windows would take turns. The other three
// follow it so the strip never says two different things in two windows.
//
// None of this touches what a decoder hears. The row is display-only (`rxdsp` says so), and so is
// every value here.

import type { ScopeWindow } from '../api'
import type { Interpolation } from './types'

export type WfSmoothing = 'average' | 'peak' | 'live'
export type WfSpeed = 'slow' | 'normal' | 'fast'

export interface WaterfallLook {
  resolution: ScopeWindow
  smoothing: WfSmoothing
  edges: Interpolation
  speed: WfSpeed
}

/** The shipped picture. A look equal to this sends nothing new to the backend and draws exactly
 *  what every build before the strip drew. */
export const LOOK_DEFAULTS: Readonly<WaterfallLook> = Object.freeze({
  resolution: 'balanced',
  smoothing: 'average',
  edges: 'linear',
  speed: 'normal',
})

/** The rig-scope preset (see the header). */
export const LOOK_RIG: Readonly<WaterfallLook> = Object.freeze({
  resolution: 'sharp',
  smoothing: 'live',
  edges: 'nearest',
  speed: 'fast',
})

export const RESOLUTIONS: readonly ScopeWindow[] = ['fast', 'balanced', 'sharp']
export const SMOOTHINGS: readonly WfSmoothing[] = ['average', 'peak', 'live']
export const EDGES: readonly Interpolation[] = ['linear', 'nearest']
export const SPEEDS: readonly WfSpeed[] = ['slow', 'normal', 'fast']

export const LOOK_KEY = 'nexus.waterfall.look'

/** Never a row faster than this, whatever the surface and the speed: the producer publishes every
 *  20 ms, and a read faster than a couple of its frames draws the same frame twice. */
export const MIN_ROW_MS = 40

function pick<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
}

/** A stored look, every field checked against its own list: a missing, stale or foreign value is
 *  that field's default, never a value nobody chose. */
export function clampLook(raw: unknown): WaterfallLook {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    resolution: pick(o.resolution, RESOLUTIONS, LOOK_DEFAULTS.resolution),
    smoothing: pick(o.smoothing, SMOOTHINGS, LOOK_DEFAULTS.smoothing),
    edges: pick(o.edges, EDGES, LOOK_DEFAULTS.edges),
    speed: pick(o.speed, SPEEDS, LOOK_DEFAULTS.speed),
  }
}

export function loadLook(): WaterfallLook {
  try {
    const s = localStorage.getItem(LOOK_KEY)
    return clampLook(s ? JSON.parse(s) : null)
  } catch {
    return { ...LOOK_DEFAULTS }
  }
}

export function saveLook(look: WaterfallLook): void {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    /* storage blocked: the look still applies this session */
  }
}

export function sameLook(a: WaterfallLook, b: WaterfallLook): boolean {
  return a.resolution === b.resolution && a.smoothing === b.smoothing && a.edges === b.edges && a.speed === b.speed
}

/** The row period at `speed`, from the surface's own `rowMs`. `normal` is `rowMs` itself, so a
 *  surface whose cadence is part of its contract (FT's 120 ms) keeps it until the operator asks. */
export function rowMsAt(speed: WfSpeed, rowMs: number): number {
  switch (speed) {
    case 'slow':
      return rowMs * 2
    case 'fast':
      return Math.max(MIN_ROW_MS, Math.round(rowMs / 2))
    case 'normal':
      return rowMs
  }
}
