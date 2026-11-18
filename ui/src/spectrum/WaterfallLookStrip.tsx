// The digital waterfall's ⚙ strip (waterfallLook.ts says what each choice does and why). Every
// sentence is in the catalog under `waterfall.look.*`; the window widths (Hz) are measurements and
// stay here, as they do on the rig scope's strip (ScaleStrip.tsx).
//
// A controlled component: the waterfall owns the look and persists it. It renders under the
// waterfall's header row, at content height, and wraps rather than clips — the rig scope's
// `.ph-scope-gear` row, reused.

import { t } from '../i18n'
import type { ScopeWindow } from '../api'
import type { Interpolation } from './types'
import {
  EDGES,
  LOOK_DEFAULTS,
  LOOK_RIG,
  RESOLUTIONS,
  SMOOTHINGS,
  SPEEDS,
  sameLook,
  type WaterfallLook,
  type WfSmoothing,
  type WfSpeed,
} from './waterfallLook'

/** The Hann main lobe the operator is choosing between — the rig scope's three labels. */
const RES_LABEL: Record<ScopeWindow, string> = { fast: '47 Hz', balanced: '23 Hz', sharp: '12 Hz' }

// Each sentence is looked up by a literal key, never through a table of keys, so the catalog
// guards (i18n/placeholders.test.ts) read every call site.
function resTitle(r: ScopeWindow): string {
  switch (r) {
    case 'fast':
      return t('waterfall.look.res.fast.title')
    case 'balanced':
      return t('waterfall.look.res.balanced.title')
    case 'sharp':
      return t('waterfall.look.res.sharp.title')
  }
}
function smoothLabel(m: WfSmoothing): string {
  switch (m) {
    case 'average':
      return t('waterfall.look.smooth.average')
    case 'peak':
      return t('waterfall.look.smooth.peak')
    case 'live':
      return t('waterfall.look.smooth.live')
  }
}
function smoothTitle(m: WfSmoothing): string {
  switch (m) {
    case 'average':
      return t('waterfall.look.smooth.average.title')
    case 'peak':
      return t('waterfall.look.smooth.peak.title')
    case 'live':
      return t('waterfall.look.smooth.live.title')
  }
}
function edgeLabel(e: Interpolation): string {
  return e === 'linear' ? t('waterfall.look.edges.linear') : t('waterfall.look.edges.nearest')
}
function edgeTitle(e: Interpolation): string {
  return e === 'linear' ? t('waterfall.look.edges.linear.title') : t('waterfall.look.edges.nearest.title')
}
function speedLabel(v: WfSpeed): string {
  switch (v) {
    case 'slow':
      return t('waterfall.look.speed.slow')
    case 'normal':
      return t('waterfall.look.speed.normal')
    case 'fast':
      return t('waterfall.look.speed.fast')
  }
}

interface Props {
  id: string
  look: WaterfallLook
  onChange: (patch: Partial<WaterfallLook>) => void
}

function Chips<T extends string>({
  aria,
  values,
  current,
  label,
  title,
  onPick,
}: {
  aria: string
  values: readonly T[]
  current: T
  label: (v: T) => string
  title: (v: T) => string | undefined
  onPick: (v: T) => void
}) {
  return (
    <span role="group" aria-label={aria}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={`ph-scope-btn${current === v ? ' on' : ''}`}
          aria-pressed={current === v}
          title={title(v)}
          onClick={() => onPick(v)}
        >
          {label(v)}
        </button>
      ))}
    </span>
  )
}

export function WaterfallLookStrip({ id, look, onChange }: Props) {
  const isRig = sameLook(look, LOOK_RIG)
  const isDefault = sameLook(look, LOOK_DEFAULTS)
  return (
    <div className="ph-scope-gear wf-look" id={id} role="group" aria-label={t('waterfall.look.aria')}>
      <Chips
        aria={t('waterfall.look.res.aria')}
        values={RESOLUTIONS}
        current={look.resolution}
        label={(r) => RES_LABEL[r]}
        title={resTitle}
        onPick={(resolution) => onChange({ resolution })}
      />
      <Chips
        aria={t('waterfall.look.smooth.aria')}
        values={SMOOTHINGS}
        current={look.smoothing}
        label={smoothLabel}
        title={smoothTitle}
        onPick={(smoothing) => onChange({ smoothing })}
      />
      <Chips
        aria={t('waterfall.look.edges.aria')}
        values={EDGES}
        current={look.edges}
        label={edgeLabel}
        title={edgeTitle}
        onPick={(edges) => onChange({ edges })}
      />
      <Chips
        aria={t('waterfall.look.speed.aria')}
        values={SPEEDS}
        current={look.speed}
        label={speedLabel}
        title={() => t('waterfall.look.speed.title')}
        onPick={(speed) => onChange({ speed })}
      />
      <span role="group" aria-label={t('waterfall.look.preset.aria')}>
        <button
          type="button"
          className={`ph-scope-btn${isRig ? ' on' : ''}`}
          aria-pressed={isRig}
          title={t('waterfall.look.preset.rig.title')}
          onClick={() => onChange({ ...LOOK_RIG })}
        >
          {t('waterfall.look.preset.rig')}
        </button>
        <button
          type="button"
          className="ph-scope-btn"
          disabled={isDefault}
          title={t('waterfall.look.preset.default.title')}
          onClick={() => onChange({ ...LOOK_DEFAULTS })}
        >
          {t('waterfall.look.preset.default')}
        </button>
      </span>
    </div>
  )
}
