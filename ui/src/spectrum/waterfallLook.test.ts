import { describe, expect, it } from 'vitest'
import { clampLook, LOOK_DEFAULTS, LOOK_RIG, MIN_ROW_MS, rowMsAt, sameLook } from './waterfallLook'

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
})
