// One value per screen pixel from a row of bins: the mapping both renderers draw through. The
// TypeScript form is canvas-2D's; `GLSL_AGGREGATE` below is the same function for WebGL2. They sit
// side by side so a change to one is a change to both; the harness's cross-backend check is what
// notices if they drift anyway.
//
// It is `resampleRow` (waterfall.ts) with a detector added, and for the peak detector it IS
// `resampleRow`: the same cell rule (bin `i` covers `[lo + i·w, lo + (i+1)·w)`), the same two
// regimes, the same NaN for a pixel whose centre is outside the row. aggregate.test.ts pins that
// equality on random rows, so the canvas-2D path draws exactly what today's paint code draws.
//
// - A pixel covering more than one bin REDUCES them: the max (peak), or the mean of their POWER
//   (average). The row is linear in dB, so the average converts to power and back. Averaging the
//   dB values themselves is the geometric-mean trap `resampleRow`'s header warns about: it reads
//   a carrier among noise bins several dB low.
// - A bin covering more than one pixel is filled by `Interpolation`, which is orthogonal to the
//   detector: the detector only ever runs in the OTHER regime. `linear` blends the two nearest bin
//   centres and is the default and the shipped behaviour — point-sampling here is the operator's
//   "looks so 8 bit" (2026-08-03). `nearest` holds the bin the pixel's centre falls in, by the
//   decimating branch's own cell rule, so the two regimes agree at the crossover; that draws bin
//   edges as edges, which is the sharper, blockier look a rig's own panadapter has.
//
// Never bin-skipping: a decimating pixel visits every bin its band touches.

import type { Detector, Interpolation } from './types'

/** The width, as a fraction of a bin, of the blend `soft` keeps around each bin boundary. */
export const SOFT_RAMP = 0.35

/** log2(10) / 10: turns a dB number into log2 of its power ratio. */
const LOG2_10_OVER_10 = Math.LOG2E * Math.LN10 / 10

/**
 * Write the value each output pixel shows into `out` (`out.length` pixels spanning
 * [`viewLoHz`, `viewHiHz`]), from the `n` bins of `src` starting at `at` that span
 * [`rowLoHz`, `rowHiHz`]. A pixel whose centre is outside the row gets NaN: the caller paints the
 * palette floor there rather than smearing the edge bin across a band with no data.
 *
 * `dbPerUnit` is only read by the average detector (see `SpectrumFrame.dbPerUnit`).
 */
export function aggregateRow(
  src: ArrayLike<number>,
  at: number,
  n: number,
  rowLoHz: number,
  rowHiHz: number,
  viewLoHz: number,
  viewHiHz: number,
  out: Float32Array,
  detector: Detector,
  dbPerUnit: number,
  interp: Interpolation = 'linear',
): void {
  const outW = out.length
  if (outW === 0) return
  const rowSpan = rowHiHz - rowLoHz
  const viewSpan = viewHiHz - viewLoHz
  if (n <= 0 || !(rowSpan > 0) || !(viewSpan > 0)) {
    out.fill(NaN)
    return
  }
  const binHz = rowSpan / n
  const pxHz = viewSpan / outW
  const decimating = pxHz > binHz
  // Power is taken relative to a value of 1 (full scale), so a 2048-bin sum of 120 dB-per-unit
  // powers stays far inside float range on the GPU as well.
  const k = dbPerUnit * LOG2_10_OVER_10
  const average = detector === 'average'
  const nearest = interp === 'nearest'
  const soft = interp === 'soft'
  for (let x = 0; x < outW; x++) {
    const fLo = viewLoHz + x * pxHz
    const fMid = fLo + pxHz * 0.5
    if (fMid < rowLoHz || fMid > rowHiHz) {
      out[x] = NaN
      continue
    }
    if (decimating) {
      let i0 = Math.floor((fLo - rowLoHz) / binHz)
      let i1 = Math.ceil((fLo + pxHz - rowLoHz) / binHz) - 1
      if (i0 < 0) i0 = 0
      if (i1 > n - 1) i1 = n - 1
      if (i1 < i0) i1 = i0
      if (average) {
        let p = 0
        for (let i = i0; i <= i1; i++) p += 2 ** ((src[at + i] - 1) * k)
        out[x] = 1 + Math.log2(p / (i1 - i0 + 1)) / k
      } else {
        let m = src[at + i0]
        for (let i = i0 + 1; i <= i1; i++) {
          const v = src[at + i]
          if (v > m) m = v
        }
        out[x] = m
      }
    } else if (nearest) {
      // The bin the pixel's CENTRE falls in, by the decimating branch's cell rule (bin `i` covers
      // `[lo + i·w, lo + (i+1)·w)`), held flat across every pixel that bin covers.
      let i = Math.floor((fMid - rowLoHz) / binHz)
      if (i < 0) i = 0
      else if (i > n - 1) i = n - 1
      out[x] = src[at + i]
    } else {
      let t = (fMid - rowLoHz) / binHz - 0.5
      if (t < 0) t = 0
      else if (t > n - 1) t = n - 1
      const b0 = Math.floor(t)
      const b1 = b0 + 1 < n ? b0 + 1 : n - 1
      let frac = t - b0
      // SOFT: flat over most of each bin, a blend only within SOFT_RAMP of the boundary halfway
      // between two centres (frac 0.5). A remap of the same blend weight, so it never leaves the
      // range of the two bins it mixes.
      if (soft) {
        frac = (frac - 0.5) / SOFT_RAMP + 0.5
        frac = frac < 0 ? 0 : frac > 1 ? 1 : frac
      }
      out[x] = src[at + b0] * (1 - frac) + src[at + b1] * frac
    }
  }
}

/** The int a shader takes for an `Interpolation` (see `GLSL_AGGREGATE`). */
export function interpCode(i: Interpolation | undefined): number {
  return i === 'nearest' ? 1 : i === 'soft' ? 2 : 0
}

/** A value's palette index (0..255) in a display range: `normalize`, then the components'
 *  `t >= 1 ? 255 : round(t·255)`. A degenerate range (`ceil <= floor`) draws the floor. */
export function lutIndex(v: number, floor: number, ceil: number): number {
  if (!(ceil > floor)) return 0
  const t = (v - floor) / (ceil - floor)
  if (!(t > 0)) return 0
  return t >= 1 ? 255 : Math.round(t * 255)
}

/** The same strength `lutIndex` maps, unquantised: 0..1 in the range (0 for a degenerate one). */
export function strengthIn(v: number, floor: number, ceil: number): number {
  if (!(ceil > floor)) return 0
  const t = (v - floor) / (ceil - floor)
  return t > 0 ? (t < 1 ? t : 1) : 0
}

/** A frame's dB per unit made safe to divide by (the average detector's only input). */
export function safeDbPerUnit(d: number): number {
  return d > 0 && Number.isFinite(d) ? d : 120
}

/**
 * The GLSL twin of `aggregateRow`, `lutIndex` and `strengthIn`, for every WebGL2 program that
 * reads bins. `src` is a single-channel float texture with one row per stored row; `row` picks it.
 * Returns false where `aggregateRow` writes NaN.
 *
 * The two mode flags are ints because a uniform cannot be a string: `detector` is 1 for `average`
 * and 0 for `peak`, `interp` is 0 for `linear`, 1 for `nearest` and 2 for `soft`
 * (`interpCode`). Only one of them is ever read
 * per pixel — they belong to the two regimes.
 */
export const GLSL_AGGREGATE = /* glsl */ `
const float LOG2_10_OVER_10 = ${LOG2_10_OVER_10.toFixed(17)};
const float SOFT_RAMP = ${SOFT_RAMP.toFixed(6)};

bool aggregateRow(sampler2D src, int row, int n, float rowLo, float rowHi, float viewLo,
                  float pxHz, float x, int detector, float dbPerUnit, int interp, out float v) {
  v = 0.0;
  float rowSpan = rowHi - rowLo;
  if (n <= 0 || !(rowSpan > 0.0) || !(pxHz > 0.0)) return false;
  float binHz = rowSpan / float(n);
  float fLo = viewLo + x * pxHz;
  float fMid = fLo + pxHz * 0.5;
  if (fMid < rowLo || fMid > rowHi) return false;
  if (pxHz > binHz) {
    int i0 = int(floor((fLo - rowLo) / binHz));
    int i1 = int(ceil((fLo + pxHz - rowLo) / binHz)) - 1;
    i0 = max(i0, 0);
    i1 = min(i1, n - 1);
    if (i1 < i0) i1 = i0;
    if (detector == 1) {
      float k = dbPerUnit * LOG2_10_OVER_10;
      float p = 0.0;
      for (int i = i0; i <= i1; i++) p += exp2((texelFetch(src, ivec2(i, row), 0).r - 1.0) * k);
      v = 1.0 + log2(p / float(i1 - i0 + 1)) / k;
    } else {
      float m = texelFetch(src, ivec2(i0, row), 0).r;
      for (int i = i0 + 1; i <= i1; i++) m = max(m, texelFetch(src, ivec2(i, row), 0).r);
      v = m;
    }
  } else if (interp == 1) {
    int i = clamp(int(floor((fMid - rowLo) / binHz)), 0, n - 1);
    v = texelFetch(src, ivec2(i, row), 0).r;
  } else {
    float t = clamp((fMid - rowLo) / binHz - 0.5, 0.0, float(n - 1));
    int b0 = int(floor(t));
    int b1 = min(b0 + 1, n - 1);
    float f = t - float(b0);
    if (interp == 2) f = clamp((f - 0.5) / SOFT_RAMP + 0.5, 0.0, 1.0);
    v = texelFetch(src, ivec2(b0, row), 0).r * (1.0 - f) + texelFetch(src, ivec2(b1, row), 0).r * f;
  }
  return true;
}

int lutIndex(float v, float lo, float hi) {
  if (!(hi > lo)) return 0;
  float t = (v - lo) / (hi - lo);
  if (!(t > 0.0)) return 0;
  return t >= 1.0 ? 255 : int(floor(t * 255.0 + 0.5));
}

float strengthIn(float v, float lo, float hi) {
  if (!(hi > lo)) return 0.0;
  return clamp((v - lo) / (hi - lo), 0.0, 1.0);
}
`
