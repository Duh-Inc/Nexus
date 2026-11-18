// 3DSS — 3D stacked-spectrum ("alternate waterfall") surface, for both renderers.
//
// Ported from AetherSDR's DssRenderer (src/gui/DssRenderer.cpp, GPLv3) — a perspective
// stacked-trace surface: a rolling history of spectrum rows drawn back-to-front (painter's
// algorithm) as a receding trapezoid. The newest trace spans the full width across the
// front; older traces recede into a narrower, higher trapezoid. Each ridge fills to the
// floor so nearer traces occlude farther ones; fill colour follows amplitude via the same
// baked LUT the 2D waterfall uses, dimmed with depth (atmospheric haze), lit by local slope,
// with a bright per-amplitude rim on each crest. See NOTICE.
//
// The canvas-2D drawing below is `../dss.ts` moved onto the shared ring (spectrum/ring.ts), and
// keeps that file's deliberate differences from the C++ original: colour from the shared
// 256-entry LUT, not a Qt palette; the zCurve pow lifts the floor as their shader does.
//
// Changes from `../dss.ts` and from the C++ original:
//  * Rows are read from the ring through each row's OWN span and display range. Ridge height is
//    anchored to the noise floor as AetherSDR anchors it, strength = clamp((v − floor) / range):
//    the floor is the host's noise estimate the row was committed with, so the noise sits on the
//    baseline and signals rise from it.
//  * Temporal median-of-3 impulse rejection, after DssRenderer.cpp's `smoothDssRow`/`median3`: a
//    column's strength is the median of that frequency in this row and the two before it, so a
//    one-row broadband burst does not throw up a wall. Taken at the same FREQUENCY through each
//    row's own span, not the same column, so it holds across a retune. Their spatial 1-2-1
//    smoothing and temporal IIR are not ported.
//  * The scrollback offset is honoured: the stack ends at the row the 2D view is showing.
//  * WebGL2 draws the same surface on the GPU (GLSL below): a fragment pass derives the anchored,
//    median-of-3 strength of every (column, row) from the texture ring each frame, then ONE
//    instanced draw displaces the mesh from it, back to front, each row's fill then its rim. The
//    geometry constants and the vertex-displacement idea are AetherSDR's
//    (resources/shaders/dss_mesh.vert). The shading follows the canvas path below rather than
//    dss_mesh.frag's vertical gradient, so both renderers draw the same surface; the GPU draws one
//    column per device pixel where canvas-2D keeps 256.
//
// SPIKES (2026-11, the waterfall ⚙ strip's 3-D Style). A second style beside the ridge surface,
// after a Yaesu rig's 3DSS: no fill and no rim, one vertical spike per column per row, coloured BY
// HEIGHT along its length (the palette's floor at the base, its hot end at the tip of a strong one),
// standing in a perspective grid. Rows do not occlude each other, so the forest behind shows between
// the spikes. Canvas-2D writes it straight into a pixel buffer (`drawDssSpikes2d`) — no path and no
// colour string per column — which is what lets it run a column per pixel on a machine with no GPU.
// Ridge stays the default and is drawn exactly as before. The median-of-3 can be turned off for
// either style (`DssLook.impulse`).

import { aggregateRow, GLSL_AGGREGATE, strengthIn } from './aggregate'
import { M_CEIL, M_DB_PER_UNIT, M_FLOOR, M_HI, M_LO, M_N, META, type SpectrumRing } from './ring'
import type { Detector, DssLook, Interpolation } from './types'

/** The shipped 3-D look: AetherSDR's ridge surface, impulse rejection on, 256 canvas-2D columns. */
export const DSS_LOOK_DEFAULT: Readonly<DssLook> = Object.freeze({ style: 'ridge', impulse: true, detail: 'fixed', height: 'lift' })

// Perspective geometry (shared with AetherSDR's dss_mesh.vert constants).
const K_BACK_WIDTH = 0.6 // back row width / front
const K_DEPTH_SPAN = 0.58 // baseline rise to the back
const K_FRONT_MAX_RIDGE = 0.46 // front ridge height / plot H
const K_HAZE = 0.16 // fade toward bg with depth
const K_SLOPE_GAIN = 0.55 // slope shading strength
const K_SHADE_LO = 0.68
const K_SHADE_HI = 1.32
const K_MIN_DIM = 0.5 // depth dimming never falls below this
const Z_CURVE = 0.55 // floor-lift exponent (their default)
/** Height curves the ⚙ strip offers (`DssLook.height`): strength^curve × full ridge. `lift` is
 *  AetherSDR's 0.55, which raises weak values and is why a busy band's noise floor stands up as a
 *  forest; `suppress` pushes them down into a low carpet so signals stand out of it. */
export const DSS_HEIGHT_CURVE: Readonly<Record<'lift' | 'linear' | 'suppress', number>> = Object.freeze({
  lift: Z_CURVE,
  linear: 1,
  suppress: 1.8,
})

/** History depth shown in the 3D stack (front → back). */
export const DSS_ROWS = 96
/** Columns the canvas-2D surface is resampled to — fewer than the 2D view (the receding rows are
 * narrow anyway) so the per-column trapezoid fill stays cheap on canvas-2D. */
export const DSS_COLS = 256
/** The GPU surface's column cap (one per device pixel up to this). */
export const DSS_MAX_GL_COLS = 4096

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** The median of three, as DssRenderer.cpp writes it. */
export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

const scratch = { cols: 0, raw: new Float32Array(0), px: new Float32Array(0), have: new Uint8Array(DSS_ROWS + 2) }

/**
 * The strength field the stack is drawn from: `rows` × `cols`, row 0 = the front (the row
 * `offsetRows` back), each value 0..1. `present[r]` is 0 where that row does not exist (not yet
 * committed, or a row with no span), and such a row is not drawn. Columns outside a row's span
 * have strength 0.
 */
export function dssStrengths(
  ring: SpectrumRing,
  cols: number,
  view: { loHz: number; hiHz: number },
  offsetRows: number,
  detector: Detector,
  out: Float32Array,
  present: Uint8Array,
  interp?: Interpolation,
  impulse = true,
): number {
  const rows = Math.max(0, Math.min(DSS_ROWS, ring.count - offsetRows))
  // Two rows past the back one feed its median.
  const span = rows + 2
  // Scratch reused across calls (it was three fresh typed arrays per redraw). Only the first
  // `span` rows are read, and every one of them is written below before it is read.
  if (scratch.cols !== cols) {
    scratch.cols = cols
    scratch.raw = new Float32Array((DSS_ROWS + 2) * cols)
    scratch.px = new Float32Array(cols)
  }
  const { raw, px } = scratch
  const have = scratch.have
  have.fill(0)
  for (let r = 0; r < span; r++) {
    const idx = ring.indexAt(offsetRows + r)
    if (idx < 0) continue
    const m = idx * META
    const n = ring.meta[m + M_N]
    const lo = ring.meta[m + M_LO]
    const hi = ring.meta[m + M_HI]
    if (!(n > 0) || !(hi > lo)) continue
    have[r] = 1
    const dbPerUnit = ring.meta[m + M_DB_PER_UNIT]
    aggregateRow(ring.values, idx * ring.cols, n, lo, hi, view.loHz, view.hiHz, px, detector, dbPerUnit, interp)
    const floor = ring.meta[m + M_FLOOR]
    const ceil = ring.meta[m + M_CEIL]
    for (let c = 0; c < cols; c++) {
      const v = px[c]
      raw[r * cols + c] = Number.isNaN(v) ? 0 : strengthIn(v, floor, ceil)
    }
  }
  for (let r = 0; r < rows; r++) {
    present[r] = have[r]
    if (!have[r]) continue
    const o = r * cols
    if (impulse && have[r + 1] && have[r + 2]) {
      for (let c = 0; c < cols; c++) out[o + c] = median3(raw[o + c], raw[o + cols + c], raw[o + 2 * cols + c])
    } else {
      out.set(raw.subarray(o, o + cols), o)
    }
  }
  return rows
}

/**
 * Render the 3DSS surface into `ctx` over a `w`×`h` device-pixel region from a strength field
 * (`dssStrengths`, `cols` wide, `rows` deep). `lut` is the baked 256×RGBA colormap; the background
 * the haze fades toward is its floor, so an empty stack reads as a quiet band.
 */
export function drawDss2d(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strengths: Float32Array,
  present: Uint8Array,
  rows: number,
  cols: number,
  lut: Uint8ClampedArray,
  zCurve: number = Z_CURVE,
): void {
  if (w <= 0 || h <= 0) return
  const H = h
  const bgR = lut[0]
  const bgG = lut[1]
  const bgB = lut[2]
  ctx.save()
  ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`
  ctx.fillRect(0, 0, w, H)

  const bottomY = H
  const depthSpan = H * K_DEPTH_SPAN
  const frontMaxRidge = H * K_FRONT_MAX_RIDGE
  const denom = DSS_ROWS

  // Reused per-row buffers (no per-frame garbage): x/y points + fill colours.
  const xs = new Float64Array(cols)
  const ys = new Float64Array(cols)

  // Back (oldest) → front (newest): painter's algorithm. Nearer traces are wider, sit lower,
  // and fill to the floor, so they occlude farther ones.
  for (let row = rows - 1; row >= 0; row--) {
    if (!present[row]) continue
    const inten = strengths.subarray(row * cols, (row + 1) * cols)
    const depthFrac = row / denom
    const rowWidthFrac = 1 - depthFrac * (1 - K_BACK_WIDTH)
    const inset = w * (1 - rowWidthFrac) * 0.5
    const rowW = w - 2 * inset
    const baselineY = bottomY - depthFrac * depthSpan
    const maxRidge = frontMaxRidge * rowWidthFrac
    const dim = K_MIN_DIM + (1 - K_MIN_DIM) * (1 - depthFrac)
    const haze = depthFrac * K_HAZE

    // Pass 1: geometry — floor-anchored ridge heights with the pow(strength, zCurve) lift.
    for (let c = 0; c < cols; c++) {
      const x = inset + (cols > 1 ? c / (cols - 1) : 0) * rowW
      xs[c] = x
      ys[c] = baselineY - Math.pow(inten[c], zCurve) * maxRidge
    }

    // Pass 2: per-column trapezoid fill toward the floor (palette by amplitude, hazed by depth,
    // lit by local slope). AA off so adjacent columns tile without seams.
    //
    // The fill stops at the next nearer row's baseline when that row is drawn: everything below it
    // is painted over by that row, which is wider and fills from its own ridge down, so the picture
    // is the same and 96 rows no longer each paint to the plot floor (about 38 screens of overdraw).
    const fillTo = row > 0 && present[row - 1] ? bottomY - ((row - 1) / denom) * depthSpan : bottomY
    const slopeScale = maxRidge > 1 ? maxRidge : 1
    ctx.imageSmoothingEnabled = false
    for (let c = 0; c < cols - 1; c++) {
      const cl = c > 0 ? c - 1 : 0
      const cr = c < cols - 1 ? c + 1 : cols - 1
      const slope = (ys[cl] - ys[cr]) / slopeScale
      const shade = clamp(1 + K_SLOPE_GAIN * slope, K_SHADE_LO, K_SHADE_HI)
      const li = ((inten[c] * 255) | 0) * 4
      // base colour → haze toward bg → scale by dim×shade
      const f = dim * shade
      const r = clamp((lut[li] + (bgR - lut[li]) * haze) * f, 0, 255) | 0
      const g = clamp((lut[li + 1] + (bgG - lut[li + 1]) * haze) * f, 0, 255) | 0
      const b = clamp((lut[li + 2] + (bgB - lut[li + 2]) * haze) * f, 0, 255) | 0
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.moveTo(xs[c], ys[c])
      ctx.lineTo(xs[c + 1], ys[c + 1])
      ctx.lineTo(xs[c + 1], fillTo)
      ctx.lineTo(xs[c], fillTo)
      ctx.closePath()
      ctx.fill()
    }

    // Ridge line — bright per-amplitude rim on the crest (front row a touch bolder).
    ctx.lineWidth = row === 0 ? 1.6 : 1
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (let c = 0; c < cols - 1; c++) {
      const li = ((inten[c] * 255) | 0) * 4
      // lighten ~1.55× (approx Qt lighter(165)), haze, then dim.
      const r = clamp((Math.min(255, lut[li] * 1.55) + (bgR - Math.min(255, lut[li] * 1.55)) * haze) * dim, 0, 255) | 0
      const g = clamp((Math.min(255, lut[li + 1] * 1.55) + (bgG - Math.min(255, lut[li + 1] * 1.55)) * haze) * dim, 0, 255) | 0
      const b = clamp((Math.min(255, lut[li + 2] * 1.55) + (bgB - Math.min(255, lut[li + 2] * 1.55)) * haze) * dim, 0, 255) | 0
      ctx.strokeStyle = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.moveTo(xs[c], ys[c])
      ctx.lineTo(xs[c + 1], ys[c + 1])
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Height levels on the grid's side walls, as fractions of a row's full ridge. */
const GRID_LEVELS = [0.25, 0.5, 0.75, 1] as const
/** Depth stations (fractions of the stack's depth) where a wall gets an upright. */
const GRID_DEPTHS = [0, 0.25, 0.5, 0.75, 1] as const
/** Palette position the grid is drawn in, and how much of it shows over the floor. */
const GRID_LUT = 0.42
const GRID_ALPHA = 0.45

/**
 * The spike style's perspective grid, as line segments in plot pixels `[x0, y0, x1, y1, …]`: the
 * floor's outline, each side wall's uprights at the depth stations, and its height levels running
 * front to back. Shared by both renderers so the walls stand in the same place on either.
 */
export function dssGridSegments(w: number, h: number): number[] {
  const seg: number[] = []
  const at = (depthFrac: number) => {
    const rowWidthFrac = 1 - depthFrac * (1 - K_BACK_WIDTH)
    const inset = w * (1 - rowWidthFrac) * 0.5
    return { l: inset, r: w - inset, base: h - depthFrac * h * K_DEPTH_SPAN, ridge: h * K_FRONT_MAX_RIDGE * rowWidthFrac }
  }
  const front = at(0)
  const back = at(1)
  // Floor outline: the back edge and both side edges (the front edge is the plot's own bottom).
  seg.push(back.l, back.base, back.r, back.base, front.l, front.base, back.l, back.base, front.r, front.base, back.r, back.base)
  for (const d of GRID_DEPTHS) {
    const p = at(d)
    seg.push(p.l, p.base, p.l, p.base - p.ridge, p.r, p.base, p.r, p.base - p.ridge)
  }
  for (const lv of GRID_LEVELS) {
    seg.push(front.l, front.base - front.ridge * lv, back.l, back.base - back.ridge * lv)
    seg.push(front.r, front.base - front.ridge * lv, back.r, back.base - back.ridge * lv)
    // The back wall's level line, so the room has a back.
    seg.push(back.l, back.base - back.ridge * lv, back.r, back.base - back.ridge * lv)
  }
  return seg
}

/** The grid's colour: the palette at `GRID_LUT`, as 0..255 RGB. */
export function dssGridRgb(lut: Uint8ClampedArray): [number, number, number] {
  const i = Math.round(GRID_LUT * 255) * 4
  return [lut[i], lut[i + 1], lut[i + 2]]
}

/** Blend one pixel of an RGBA buffer toward `rgb` by `a`. */
function blendPx(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const o = (y * w + x) * 4
  d[o] += (r - d[o]) * a
  d[o + 1] += (g - d[o + 1]) * a
  d[o + 2] += (b - d[o + 2]) * a
}

/** A 1 px line into an RGBA buffer (DDA; the grid is a few dozen short lines, drawn once a draw). */
function lineInto(d: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a: number): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    blendPx(d, w, h, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgb[0], rgb[1], rgb[2], a)
  }
}

/**
 * The spike style on canvas-2D, written straight into `img` (`w`×`h`, reused by the caller) and put
 * at the top-left of `ctx`. Back row first; each column of each row is one spike from the row's
 * baseline up to its height, every pixel of it coloured by the height it stands at, then dimmed and
 * hazed by depth as the ridge style is. Nothing fills under a spike, so the rows behind show through.
 */
export function drawDssSpikes2d(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  strengths: Float32Array,
  present: Uint8Array,
  rows: number,
  cols: number,
  lut: Uint8ClampedArray,
  zCurve: number = Z_CURVE,
): void {
  const w = img.width
  const H = img.height
  if (w <= 0 || H <= 0) return
  const d = img.data
  const bgR = lut[0]
  const bgG = lut[1]
  const bgB = lut[2]
  for (let o = 0; o < d.length; o += 4) {
    d[o] = bgR
    d[o + 1] = bgG
    d[o + 2] = bgB
    d[o + 3] = 255
  }
  const grid = dssGridSegments(w, H)
  const gridRgb = dssGridRgb(lut)
  for (let i = 0; i < grid.length; i += 4) lineInto(d, w, H, grid[i], grid[i + 1], grid[i + 2], grid[i + 3], gridRgb, GRID_ALPHA)

  const depthSpan = H * K_DEPTH_SPAN
  const frontMaxRidge = H * K_FRONT_MAX_RIDGE
  // Per-height colour of the current row, rebuilt per row (a row's ridge is at most ~half the plot).
  const ramp = new Uint8ClampedArray((Math.ceil(frontMaxRidge) + 2) * 3)
  for (let row = rows - 1; row >= 0; row--) {
    if (!present[row]) continue
    const inten = strengths.subarray(row * cols, (row + 1) * cols)
    const depthFrac = row / DSS_ROWS
    const rowWidthFrac = 1 - depthFrac * (1 - K_BACK_WIDTH)
    const inset = w * (1 - rowWidthFrac) * 0.5
    const rowW = w - 2 * inset
    const baseline = Math.round(H - depthFrac * depthSpan)
    const maxRidge = frontMaxRidge * rowWidthFrac
    const dim = K_MIN_DIM + (1 - K_MIN_DIM) * (1 - depthFrac)
    const haze = depthFrac * K_HAZE
    const top = Math.ceil(maxRidge)
    // The strength a pixel `k` above the baseline stands for: the inverse of the zCurve lift.
    for (let k = 0; k <= top; k++) {
      const s = Math.pow(Math.min(1, k / (maxRidge > 0 ? maxRidge : 1)), 1 / zCurve)
      const li = ((s * 255) | 0) * 4
      ramp[k * 3] = clamp((lut[li] + (bgR - lut[li]) * haze) * dim, 0, 255)
      ramp[k * 3 + 1] = clamp((lut[li + 1] + (bgG - lut[li + 1]) * haze) * dim, 0, 255)
      ramp[k * 3 + 2] = clamp((lut[li + 2] + (bgB - lut[li + 2]) * haze) * dim, 0, 255)
    }
    const colW = cols > 1 ? rowW / (cols - 1) : rowW
    for (let c = 0; c < cols; c++) {
      const ht = Math.round(Math.pow(inten[c], zCurve) * maxRidge)
      if (ht <= 0) continue
      const x0 = Math.round(inset + c * colW - colW * 0.5)
      const x1 = Math.max(x0 + 1, Math.round(inset + c * colW + colW * 0.5))
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        for (let k = 1; k <= ht; k++) {
          const y = baseline - k
          if (y < 0) break
          if (y >= H) continue
          const o = (y * w + x) * 4
          d[o] = ramp[k * 3]
          d[o + 1] = ramp[k * 3 + 1]
          d[o + 2] = ramp[k * 3 + 2]
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

// ---------------------------------------------------------------------------------------------
// WebGL2. Both passes read the same ring textures the 2D waterfall does (webgl2.ts binds them).

const GLSL_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`

/** Unpack a strength the derive pass stored as 16 bits in an RGBA8 texel's R and G. */
const GLSL_DSS_AT = `
float dssAt(sampler2D field, int c, int r) {
  vec4 t = texelFetch(field, ivec2(c, r), 0);
  return (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) / 65535.0;
}
`

/** Pass 1, one fragment per (column, depth row) of an RGBA8 target `cols` × `DSS_ROWS`: the
 *  anchored, median-of-3 strength, packed into R and G; B = 1 where the row exists. */
export const GLSL_DSS_DERIVE_FS = `${GLSL_HEAD}
uniform sampler2D uRing;
uniform sampler2D uMeta;
uniform int uHead;
uniform int uCount;
uniform int uDepth;
uniform int uOffset;
uniform int uCols;
uniform int uDetector;
uniform int uInterp;
uniform int uMedian;
uniform float uViewLo;
uniform float uViewHi;
out vec4 outColor;
${GLSL_AGGREGATE}
bool rowStrength(int age, float x, out float s) {
  s = 0.0;
  if (age >= uCount) return false;
  int r = uHead - age;
  if (r < 0) r += uDepth;
  vec4 m0 = texelFetch(uMeta, ivec2(0, r), 0);
  if (m0.z < 0.5 || !(m0.y > m0.x)) return false;
  vec4 m1 = texelFetch(uMeta, ivec2(1, r), 0);
  float v;
  if (aggregateRow(uRing, r, int(m0.z), m0.x, m0.y, uViewLo, (uViewHi - uViewLo) / float(uCols), x,
                   uDetector, m0.w, uInterp, v)) s = strengthIn(v, m1.x, m1.y);
  return true;
}
void main() {
  int c = int(gl_FragCoord.x);
  int r = int(gl_FragCoord.y);
  float x = float(c);
  float s0;
  if (!rowStrength(uOffset + r, x, s0)) {
    outColor = vec4(0.0);
    return;
  }
  float s1;
  float s2;
  if (uMedian == 1 && rowStrength(uOffset + r + 1, x, s1) && rowStrength(uOffset + r + 2, x, s2)) {
    s0 = max(min(s0, s1), min(max(s0, s1), s2));
  }
  float u = floor(s0 * 65535.0 + 0.5);
  outColor = vec4(floor(u / 256.0) / 255.0, mod(u, 256.0) / 255.0, 1.0, 1.0);
}
`

/** Pass 2, `drawArraysInstanced(TRIANGLES, 0, (cols − 1) × 12, rows)`: instance 0 is the back row.
 *  Within an instance the fill segments come first, then the rim, so a row's rim lies over its own
 *  fill and under the next row's, as the canvas path paints them. */
export const GLSL_DSS_MESH_VS = `${GLSL_HEAD}
uniform sampler2D uField;
uniform sampler2D uLut;
uniform int uCols;
uniform int uRows;
uniform float uW;
uniform float uH;
uniform float uPlotH;
uniform int uStyle;
out vec4 vColor;
out float vAcross;
out float vHalf;
out float vHt;
out float vDim;
out float vHaze;
const float DSS_ROWS = ${DSS_ROWS}.0;
const float K_BACK_WIDTH = ${K_BACK_WIDTH};
const float K_DEPTH_SPAN = ${K_DEPTH_SPAN};
const float K_FRONT_MAX_RIDGE = ${K_FRONT_MAX_RIDGE};
const float K_HAZE = ${K_HAZE};
const float K_SLOPE_GAIN = ${K_SLOPE_GAIN};
const float K_SHADE_LO = ${K_SHADE_LO};
const float K_SHADE_HI = ${K_SHADE_HI};
const float K_MIN_DIM = ${K_MIN_DIM};
uniform float uZCurve;
${GLSL_DSS_AT}
void main() {
  int r = uRows - 1 - gl_InstanceID;
  int segs = uCols - 1;
  int v = gl_VertexID;
  bool rim = v >= segs * 6;
  if (rim) v -= segs * 6;
  int s = v / 6;
  int corner = v - s * 6;
  vHalf = 1.0e6;
  vAcross = 0.0;
  vHt = -1.0;
  vDim = 1.0;
  vHaze = 0.0;
  if (texelFetch(uField, ivec2(0, r), 0).b < 0.5) {
    // An absent row: put the vertex outside the clip volume so the triangle is dropped.
    vColor = vec4(0.0);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float depthFrac = float(r) / DSS_ROWS;
  float rowWidthFrac = 1.0 - depthFrac * (1.0 - K_BACK_WIDTH);
  float inset = uW * (1.0 - rowWidthFrac) * 0.5;
  float rowW = uW - 2.0 * inset;
  float baselineY = uPlotH - depthFrac * uPlotH * K_DEPTH_SPAN;
  float maxRidge = uPlotH * K_FRONT_MAX_RIDGE * rowWidthFrac;
  float dim = K_MIN_DIM + (1.0 - K_MIN_DIM) * (1.0 - depthFrac);
  float haze = depthFrac * K_HAZE;
  float st0 = dssAt(uField, s, r);
  float st1 = dssAt(uField, s + 1, r);
  vec2 p0 = vec2(inset + float(s) / float(segs) * rowW, baselineY - pow(st0, uZCurve) * maxRidge);
  vec2 p1 = vec2(inset + float(s + 1) / float(segs) * rowW, baselineY - pow(st1, uZCurve) * maxRidge);
  int li = int(st0 * 255.0);
  vec3 base = texelFetch(uLut, ivec2(li, 0), 0).rgb * 255.0;
  vec3 bg = texelFetch(uLut, ivec2(0, 0), 0).rgb * 255.0;
  vec2 pos;
  if (uStyle == 1) {
    // SPIKES: segment s is column s's spike, a quad from the baseline up to its height, and no rim.
    // The fragment shader colours it by the height each fragment stands at (vHt, in units of the
    // row's full ridge), which is the canvas path's per-pixel ramp.
    if (rim || st0 <= 0.0) {
      vColor = vec4(0.0);
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    float colW = rowW / float(segs);
    float x0 = p0.x - colW * 0.5;
    float x1 = max(x0 + 1.0, p0.x + colW * 0.5);
    float ht = pow(st0, uZCurve);
    bool up = corner == 0 || corner == 1 || corner == 3;
    bool right = corner == 1 || corner == 2 || corner == 4;
    pos = vec2(right ? x1 : x0, up ? baselineY - ht * maxRidge : baselineY);
    vHt = up ? ht : 0.0;
    vDim = dim;
    vHaze = haze;
    vColor = vec4(1.0);
    gl_Position = vec4(pos.x / uW * 2.0 - 1.0, 1.0 - pos.y / uH * 2.0, 0.0, 1.0);
    return;
  }
  if (!rim) {
    // Down to the next nearer row's baseline when that row is drawn (the canvas path's reason).
    float fillTo = r > 0 && texelFetch(uField, ivec2(0, r - 1), 0).b > 0.5
      ? uPlotH - float(r - 1) / DSS_ROWS * uPlotH * K_DEPTH_SPAN
      : uPlotH;
    float stl = dssAt(uField, max(s - 1, 0), r);
    float yl = baselineY - pow(stl, uZCurve) * maxRidge;
    float slope = (yl - p1.y) / (maxRidge > 1.0 ? maxRidge : 1.0);
    float shade = clamp(1.0 + K_SLOPE_GAIN * slope, K_SHADE_LO, K_SHADE_HI);
    vec3 c = clamp((base + (bg - base) * haze) * (dim * shade), 0.0, 255.0);
    vColor = vec4(floor(c) / 255.0, 1.0);
    if (corner == 0 || corner == 3) pos = p0;
    else if (corner == 1) pos = p1;
    else if (corner == 2 || corner == 4) pos = vec2(p1.x, fillTo);
    else pos = vec2(p0.x, fillTo);
  } else {
    vec3 lit = min(base * 1.55, vec3(255.0));
    vec3 c = clamp((lit + (bg - lit) * haze) * dim, 0.0, 255.0);
    vColor = vec4(floor(c) / 255.0, 1.0);
    // A ribbon around the segment, half a pixel wider each side for the anti-aliased edge and
    // extended past both ends (the canvas path's round caps).
    float lw = r == 0 ? 1.6 : 1.0;
    vec2 d = p1 - p0;
    float len = length(d);
    d = len > 0.0 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-d.y, d.x);
    float hw = lw * 0.5 + 0.5;
    float side = (corner == 0 || corner == 1 || corner == 3) ? 1.0 : -1.0;
    bool atEnd = corner == 1 || corner == 2 || corner == 4;
    pos = (atEnd ? p1 + d * hw : p0 - d * hw) + nrm * hw * side;
    vAcross = side * hw;
    vHalf = lw * 0.5;
  }
  gl_Position = vec4(pos.x / uW * 2.0 - 1.0, 1.0 - pos.y / uH * 2.0, 0.0, 1.0);
}
`

export const GLSL_DSS_MESH_FS = `${GLSL_HEAD}
uniform sampler2D uLut;
in vec4 vColor;
in float vAcross;
in float vHalf;
in float vHt;
in float vDim;
in float vHaze;
out vec4 outColor;
uniform float uZCurve;
void main() {
  if (vHt >= 0.0) {
    // A spike: the palette at the strength this height stands for, hazed and dimmed by depth.
    float s = pow(clamp(vHt, 0.0, 1.0), 1.0 / uZCurve);
    vec3 base = texelFetch(uLut, ivec2(int(s * 255.0), 0), 0).rgb;
    vec3 bg = texelFetch(uLut, ivec2(0, 0), 0).rgb;
    outColor = vec4(clamp((base + (bg - base) * vHaze) * vDim, 0.0, 1.0), 1.0);
    return;
  }
  float a = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0);
  outColor = vec4(vColor.rgb, vColor.a * a);
}
`

/** The spike style's grid: \`gl.LINES\` over \`dssGridSegments\`, in plot pixels. */
export const GLSL_DSS_GRID_VS = `${GLSL_HEAD}
in vec2 aPos;
uniform float uW;
uniform float uH;
uniform float uTop;
void main() {
  gl_Position = vec4(aPos.x / uW * 2.0 - 1.0, 1.0 - (aPos.y + uTop) / uH * 2.0, 0.0, 1.0);
}
`
export const GLSL_DSS_GRID_FS = `${GLSL_HEAD}
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}
`
export const DSS_GRID_ALPHA = GRID_ALPHA

/** The full-screen triangle every fragment pass draws (`drawArrays(TRIANGLES, 0, 3)`). */
export const GLSL_FULLSCREEN_VS = `${GLSL_HEAD}
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}
`

export { GLSL_HEAD }
