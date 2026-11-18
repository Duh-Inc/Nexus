// @vitest-environment jsdom
//
// THE ⚙ STRIP (spectrum/waterfallLook.ts): the waterfall's sharpness, one click from its header.
// Closed by default; the shipped look until the operator picks; persisted app-wide; and a change in
// another window (a torn-off waterfall) is followed, because both read the one producer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Waterfall } from './Waterfall'
import { t } from '../i18n'
import { LOOK_DEFAULTS, LOOK_KEY, LOOK_RIG, loadLook } from '../spectrum/waterfallLook'

vi.mock('../api', () => ({
  getSpectrumRow: () => Promise.resolve({ row: [], loHz: 0, hiHz: 5000 }),
}))

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const wf = () => <Waterfall transmitting={false} rxOffsetHz={1500} txOffsetHz={1500} theme="dark" />
const gear = () => screen.getByRole('button', { name: t('waterfall.look.gear.aria') })
const strip = () => screen.queryByRole('group', { name: t('waterfall.look.aria') })

describe('the waterfall ⚙ strip', () => {
  it('is closed until asked for, and unlit at the shipped look', () => {
    render(wf())
    expect(strip()).toBeNull()
    expect(gear().getAttribute('aria-expanded')).toBe('false')
    expect(gear().className).not.toMatch(/\bon\b/)
    fireEvent.click(gear())
    expect(strip()).not.toBeNull()
    expect(gear().getAttribute('aria-expanded')).toBe('true')
  })

  it('applies the rig preset, persists it, and keeps ⚙ lit once closed so the look has a visible cause', () => {
    render(wf())
    fireEvent.click(gear())
    fireEvent.click(screen.getByRole('button', { name: t('waterfall.look.preset.rig') }))
    expect(loadLook()).toEqual(LOOK_RIG)
    expect(screen.getByRole('button', { name: '12 Hz' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: t('waterfall.look.smooth.live') }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(gear())
    expect(strip()).toBeNull()
    expect(gear().className).toMatch(/\bon\b/)
    // And Default puts it all back.
    fireEvent.click(gear())
    fireEvent.click(screen.getByRole('button', { name: t('waterfall.look.preset.default') }))
    expect(loadLook()).toEqual(LOOK_DEFAULTS)
  })

  it('changes one setting at a time', () => {
    render(wf())
    fireEvent.click(gear())
    fireEvent.click(screen.getByRole('button', { name: t('waterfall.look.edges.nearest') }))
    expect(loadLook()).toEqual({ ...LOOK_DEFAULTS, edges: 'nearest' })
  })

  it('follows a change made in another window', () => {
    render(wf())
    fireEvent.click(gear())
    localStorage.setItem(LOOK_KEY, JSON.stringify(LOOK_RIG))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LOOK_KEY }))
    })
    expect(screen.getByRole('button', { name: t('waterfall.look.preset.rig') }).getAttribute('aria-pressed')).toBe('true')
  })

  it('offers the three 3-D settings only while the 3-D view is on', () => {
    render(wf())
    fireEvent.click(gear())
    const style = () => screen.queryByRole('group', { name: t('waterfall.look.threeD.style.aria') })
    expect(style()).toBeNull()
    fireEvent.click(screen.getByTitle(t('waterfall.dss.off.title')))
    expect(style()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('waterfall.look.threeD.style.spikes') }))
    expect(loadLook()).toEqual({ ...LOOK_DEFAULTS, style3d: 'spikes' })
  })
})
