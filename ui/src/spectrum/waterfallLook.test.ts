import { describe, expect, it } from 'vitest'
import { clampLook, dssLookOf, LOOK_DEFAULTS, LOOK_RIG, MIN_ROW_MS, rowMsAt, sameLook } from './waterfallLook'
import { DSS_LOOK_DEFAULT } from './dss'

describe('waterfallLook', () => {
  it('reads a missing or foreign record as the shipped look, field by field', () => {
    expect(clampLook(null)).toEqual(LOOK_DEFAULTS)
    expect(clampLook('sharp')).toEqual(LOOK_DEFAULTS)
    expect(clampLook({ resolution: 'sharp', smoothing: 'boil', edges: 7, speed: 'fast' })).toEqual({
      ...LOOK_DEFAULTS,
      resolution: 'sharp',
      speed: 'fast',
    })
    expect(clampLook({ ...LOOK_RIG })).toEqual(LOOK_RIG)
  })

  it('keeps the surface cadence at normal speed and bounds the fast one', () => {
    expect(rowMsAt('normal', 120)).toBe(120)
    expect(rowMsAt('slow', 120)).toBe(240)
    expect(rowMsAt('fast', 120)).toBe(60)
    expect(rowMsAt('fast', 50)).toBe(MIN_ROW_MS)
  })

  it('makes the rig preset differ from the default in every field', () => {
    expect(sameLook(LOOK_RIG, LOOK_DEFAULTS)).toBe(false)
    for (const k of Object.keys(LOOK_DEFAULTS) as (keyof typeof LOOK_DEFAULTS)[]) {
      expect(LOOK_RIG[k], k).not.toBe(LOOK_DEFAULTS[k])
    }
  })

  it('maps the default look to the shipped 3-D look, and the rig preset to spikes with no filter', () => {
    expect(dssLookOf({ ...LOOK_DEFAULTS })).toEqual(DSS_LOOK_DEFAULT)
    expect(dssLookOf({ ...LOOK_RIG })).toEqual({ style: 'spikes', impulse: false, detail: 'pixel' })
    expect(clampLook({ style3d: 'cubes', impulse3d: true, detail3d: 'pixel' })).toEqual({ ...LOOK_DEFAULTS, detail3d: 'pixel' })
  })
})
