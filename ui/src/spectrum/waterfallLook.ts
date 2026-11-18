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
// and three for the 3-D stack (dss.ts `DssLook`), shown only while the 3-D view is on:
//
//   style3d     ridge (AetherSDR's filled surface) or spikes (a Yaesu rig's 3DSS: thin spikes
//               coloured by height in a perspective grid).
//   impulse3d   the median-of-3 over time that rejects one-row bursts, on or off.
//   detail3d    canvas-2D's columns: fixed (256) or one per pixel. WebGL2 is per pixel already.
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
import type { DssLook, Interpolation } from './types'

export type WfSmoothing = 'average' | 'peak' | 'live'
export type WfSpeed = 'slow' | 'normal' | 'fast'
export type Wf3dStyle = DssLook['style']
export type WfOnOff = 'on' | 'off'
export type Wf3dDetail = DssLook['detail']

export interface WaterfallLook {
  resolution: ScopeWindow
  smoothing: WfSmoothing
  edges: Interpolation
  speed: WfSpeed
  style3d: Wf3dStyle
  impulse3d: WfOnOff
  detail3d: Wf3dDetail
}

/** The shipped picture. A look equal to this sends nothing new to the backend and draws exactly
 *  what every build before the strip drew. */
export const LOOK_DEFAULTS: Readonly<WaterfallLook> = Object.freeze({
  resolution: 'balanced',
  smoothing: 'average',
  edges: 'linear',
  speed: 'normal',
  style3d: 'ridge',
  impulse3d: 'on',
  detail3d: 'fixed',
})

/** The rig-scope preset (see the header). */
export const LOOK_RIG: Readonly<WaterfallLook> = Object.freeze({
  resolution: 'sharp',
  smoothing: 'live',
  edges: 'nearest',
  speed: 'fast',
  style3d: 'spikes',
  impulse3d: 'off',
  detail3d: 'pixel',
})

export const RESOLUTIONS: readonly ScopeWindow[] = ['fast', 'balanced', 'sharp']
export const SMOOTHINGS: readonly WfSmoothing[] = ['average', 'peak', 'live']
export const EDGES: readonly Interpolation[] = ['linear', 'nearest']
export const SPEEDS: readonly WfSpeed[] = ['slow', 'normal', 'fast']
export const STYLES_3D: readonly Wf3dStyle[] = ['ridge', 'spikes']
export const ON_OFF: readonly WfOnOff[] = ['on', 'off']
export const DETAILS_3D: readonly Wf3dDetail[] = ['fixed', 'pixel']

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
    style3d: pick(o.style3d, STYLES_3D, LOOK_DEFAULTS.style3d),
    impulse3d: pick(o.impulse3d, ON_OFF, LOOK_DEFAULTS.impulse3d),
    detail3d: pick(o.detail3d, DETAILS_3D, LOOK_DEFAULTS.detail3d),
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
  return (Object.keys(LOOK_DEFAULTS) as (keyof WaterfallLook)[]).every((k) => a[k] === b[k])
}

/** The 3-D half of a look, as the renderer takes it. */
export function dssLookOf(look: WaterfallLook): DssLook {
  return { style: look.style3d, impulse: look.impulse3d === 'on', detail: look.detail3d }
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
