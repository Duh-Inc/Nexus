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
//   height3d    how strength becomes height: lift (today), linear, or suppress (noise to a carpet).
//
// CLUTTER (operator, 2026-11-18: the 3-D view is "mostly noise drawn tall"). Sharpness was half of
// it; the other half is where the noise lands on the palette and how tall it stands. Two 2-D
// choices answer it, and both reach the 3-D colours too, because they shape the values and the
// palette every view draws through:
//
//   contrast    a curve baked into the palette: linear (today), medium or high. Steeper curves keep
//               the noise near the floor colour and spend the palette on signals.
//   floor       where black sits above the measured noise: 2 dB (today, WF_PARK_DB), 6 or 10 dB.
//
// and a producer choice:
//
//   sharpen     off (today) or reassign: each bin's energy is moved to the frequency the signal in it
//               is actually at (rxdsp), so a steady tone collapses toward one bin without the longer
//               window's vertical smear.
//
// CRISP sits between the default and RIG: thinner signals and less clutter, but still averaged
// enough to read weak ones. The operator asked for exactly that middle ("half smooth").
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
export type Wf3dHeight = NonNullable<DssLook['height']>
export type WfContrast = 'linear' | 'medium' | 'high'
export type WfFloor = 'low' | 'mid' | 'high'
export type WfSharpen = 'off' | 'reassign'

export interface WaterfallLook {
  resolution: ScopeWindow
  smoothing: WfSmoothing
  edges: Interpolation
  speed: WfSpeed
  style3d: Wf3dStyle
  impulse3d: WfOnOff
  detail3d: Wf3dDetail
  height3d: Wf3dHeight
  contrast: WfContrast
  floor: WfFloor
  sharpen: WfSharpen
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
  height3d: 'lift',
  contrast: 'linear',
  floor: 'low',
  sharpen: 'off',
})

/** The middle: sharper and much less cluttered than the default, still averaged so weak signals
 *  read. Hard edges are left to RIG; this keeps a short blend. */
export const LOOK_CRISP: Readonly<WaterfallLook> = Object.freeze({
  resolution: 'sharp',
  smoothing: 'peak',
  edges: 'soft',
  speed: 'normal',
  style3d: 'spikes',
  impulse3d: 'on',
  detail3d: 'pixel',
  height3d: 'linear',
  contrast: 'medium',
  floor: 'mid',
  sharpen: 'reassign',
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
  height3d: 'suppress',
  // Medium and +6 dB, not High and +10: measured on a simulated band of 22 FT8 stations, the
  // stronger pair with Live's unaveraged rows hid every station below about -17 dB SNR. A rig's own
  // scope still shows those.
  contrast: 'medium',
  floor: 'mid',
  sharpen: 'reassign',
})

export const RESOLUTIONS: readonly ScopeWindow[] = ['fast', 'balanced', 'sharp']
export const SMOOTHINGS: readonly WfSmoothing[] = ['average', 'peak', 'live']
export const EDGES: readonly Interpolation[] = ['linear', 'soft', 'nearest']
export const SPEEDS: readonly WfSpeed[] = ['slow', 'normal', 'fast']
export const STYLES_3D: readonly Wf3dStyle[] = ['ridge', 'spikes']
export const ON_OFF: readonly WfOnOff[] = ['on', 'off']
export const DETAILS_3D: readonly Wf3dDetail[] = ['fixed', 'pixel']
export const HEIGHTS_3D: readonly Wf3dHeight[] = ['lift', 'linear', 'suppress']
export const CONTRASTS: readonly WfContrast[] = ['linear', 'medium', 'high']
export const FLOORS: readonly WfFloor[] = ['low', 'mid', 'high']
export const SHARPENS: readonly WfSharpen[] = ['off', 'reassign']

/** dB the black point sits above the measured noise median, per `floor` (parkFloor's `parkDb`). */
export const FLOOR_DB: Readonly<Record<WfFloor, number>> = Object.freeze({ low: 2, mid: 6, high: 10 })

/** The exponent of each contrast curve (t ↦ t^γ). */
const CONTRAST_GAMMA: Readonly<Record<Exclude<WfContrast, 'linear'>, number>> = Object.freeze({ medium: 1.6, high: 2.4 })
const CONTRAST_CURVES: Readonly<Record<Exclude<WfContrast, 'linear'>, (t: number) => number>> = Object.freeze({
  medium: (t: number) => Math.pow(t, CONTRAST_GAMMA.medium),
  high: (t: number) => Math.pow(t, CONTRAST_GAMMA.high),
})

/** The contrast curve a look draws through, composed after the host's own (RTTY's), or undefined
 *  for none at all. Stable for a stable pair: the waterfall memoises on its inputs. */
export function contrastCurveOf(contrast: WfContrast, host?: (t: number) => number): ((t: number) => number) | undefined {
  if (contrast === 'linear') return host
  const c = CONTRAST_CURVES[contrast]
  return host ? (t: number) => c(host(t)) : c
}

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
    height3d: pick(o.height3d, HEIGHTS_3D, LOOK_DEFAULTS.height3d),
    contrast: pick(o.contrast, CONTRASTS, LOOK_DEFAULTS.contrast),
    floor: pick(o.floor, FLOORS, LOOK_DEFAULTS.floor),
    sharpen: pick(o.sharpen, SHARPENS, LOOK_DEFAULTS.sharpen),
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
  return { style: look.style3d, impulse: look.impulse3d === 'on', detail: look.detail3d, height: look.height3d }
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
