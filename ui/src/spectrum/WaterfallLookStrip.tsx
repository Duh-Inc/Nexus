// The digital waterfall's ⚙ strip (waterfallLook.ts says what each choice does and why). Every
// sentence is in the catalog under `waterfall.look.*`; the window widths (Hz) and the floor offsets
// (dB) are measurements and stay here, as they do on the rig scope's strip (ScaleStrip.tsx).
//
// A controlled component: the waterfall owns the look and persists it. It renders under the
// waterfall's header row, at content height, and wraps rather than clips — the rig scope's
// `.ph-scope-gear` row, reused. With eleven choices, each group carries a visible label (its
// accessible name, so the two never disagree): unlabelled, "Off · On" and "Low · Mid · High" read
// as nothing in particular.

import { t } from '../i18n'
import type { ScopeWindow } from '../api'
import type { Interpolation } from './types'
import {
  CONTRASTS,
  DETAILS_3D,
  EDGES,
  FLOORS,
  HEIGHTS_3D,
  LOOK_CRISP,
  LOOK_DEFAULTS,
  LOOK_RIG,
  ON_OFF,
  RESOLUTIONS,
  SHARPENS,
  SMOOTHINGS,
  SPEEDS,
  STYLES_3D,
  sameLook,
  type WaterfallLook,
  type Wf3dDetail,
  type Wf3dHeight,
  type Wf3dStyle,
  type WfContrast,
  type WfFloor,
  type WfOnOff,
  type WfSharpen,
  type WfSmoothing,
  type WfSpeed,
} from './waterfallLook'

/** The Hann main lobe the operator is choosing between — the rig scope's three labels. */
const RES_LABEL: Record<ScopeWindow, string> = { fast: '47 Hz', balanced: '23 Hz', sharp: '12 Hz' }
/** The black point above the noise, as the measurement it is. */
const FLOOR_LABEL: Record<WfFloor, string> = { low: '+2 dB', mid: '+6 dB', high: '+10 dB' }

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
  switch (e) {
    case 'linear':
      return t('waterfall.look.edges.linear')
    case 'soft':
      return t('waterfall.look.edges.soft')
    case 'nearest':
      return t('waterfall.look.edges.nearest')
  }
}
function edgeTitle(e: Interpolation): string {
  switch (e) {
    case 'linear':
      return t('waterfall.look.edges.linear.title')
    case 'soft':
      return t('waterfall.look.edges.soft.title')
    case 'nearest':
      return t('waterfall.look.edges.nearest.title')
  }
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
function contrastLabel(v: WfContrast): string {
  switch (v) {
    case 'linear':
      return t('waterfall.look.contrast.linear')
    case 'medium':
      return t('waterfall.look.contrast.medium')
    case 'high':
      return t('waterfall.look.contrast.high')
  }
}
function sharpenLabel(v: WfSharpen): string {
  return v === 'off' ? t('waterfall.look.sharpen.off') : t('waterfall.look.sharpen.on')
}
function style3dLabel(v: Wf3dStyle): string {
  return v === 'ridge' ? t('waterfall.look.threeD.style.ridge') : t('waterfall.look.threeD.style.spikes')
}
function style3dTitle(v: Wf3dStyle): string {
  return v === 'ridge' ? t('waterfall.look.threeD.style.ridge.title') : t('waterfall.look.threeD.style.spikes.title')
}
function impulseLabel(v: WfOnOff): string {
  return v === 'on' ? t('waterfall.look.threeD.impulse.on') : t('waterfall.look.threeD.impulse.off')
}
function detailLabel(v: Wf3dDetail): string {
  return v === 'fixed' ? t('waterfall.look.threeD.detail.fixed') : t('waterfall.look.threeD.detail.pixel')
}
function detailTitle(v: Wf3dDetail): string {
  return v === 'fixed' ? t('waterfall.look.threeD.detail.fixed.title') : t('waterfall.look.threeD.detail.pixel.title')
}
function heightLabel(v: Wf3dHeight): string {
  switch (v) {
    case 'lift':
      return t('waterfall.look.threeD.height.lift')
    case 'linear':
      return t('waterfall.look.threeD.height.linear')
    case 'suppress':
      return t('waterfall.look.threeD.height.suppress')
  }
}
function heightTitle(v: Wf3dHeight): string {
  switch (v) {
    case 'lift':
      return t('waterfall.look.threeD.height.lift.title')
    case 'linear':
      return t('waterfall.look.threeD.height.linear.title')
    case 'suppress':
      return t('waterfall.look.threeD.height.suppress.title')
  }
}

interface Props {
  id: string
  look: WaterfallLook
  onChange: (patch: Partial<WaterfallLook>) => void
  /** The 3-D view is on: offer its four settings too. Hidden in 2D, where they change nothing. */
  threeD?: boolean
}

function Chips<T extends string>({
  name,
  values,
  current,
  label,
  title,
  onPick,
}: {
  name: string
  values: readonly T[]
  current: T
  label: (v: T) => string
  title: (v: T) => string | undefined
  onPick: (v: T) => void
}) {
  return (
    <span role="group" aria-label={name} className="wf-look-group">
      <span className="wf-look-name" aria-hidden="true">
        {name}
      </span>
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

export function WaterfallLookStrip({ id, look, onChange, threeD }: Props) {
  const isRig = sameLook(look, LOOK_RIG)
  const isCrisp = sameLook(look, LOOK_CRISP)
  const isDefault = sameLook(look, LOOK_DEFAULTS)
  return (
    <div className="ph-scope-gear wf-look" id={id} role="group" aria-label={t('waterfall.look.aria')}>
      <span role="group" aria-label={t('waterfall.look.preset.aria')} className="wf-look-group">
        <button
          type="button"
          className="ph-scope-btn"
          disabled={isDefault}
          title={t('waterfall.look.preset.default.title')}
          onClick={() => onChange({ ...LOOK_DEFAULTS })}
        >
          {t('waterfall.look.preset.default')}
        </button>
        <button
          type="button"
          className={`ph-scope-btn${isCrisp ? ' on' : ''}`}
          aria-pressed={isCrisp}
          title={t('waterfall.look.preset.crisp.title')}
          onClick={() => onChange({ ...LOOK_CRISP })}
        >
          {t('waterfall.look.preset.crisp')}
        </button>
        <button
          type="button"
          className={`ph-scope-btn${isRig ? ' on' : ''}`}
          aria-pressed={isRig}
          title={t('waterfall.look.preset.rig.title')}
          onClick={() => onChange({ ...LOOK_RIG })}
        >
          {t('waterfall.look.preset.rig')}
        </button>
      </span>
      <Chips
        name={t('waterfall.look.contrast.aria')}
        values={CONTRASTS}
        current={look.contrast}
        label={contrastLabel}
        title={() => t('waterfall.look.contrast.title')}
        onPick={(contrast) => onChange({ contrast })}
      />
      <Chips
        name={t('waterfall.look.floor.aria')}
        values={FLOORS}
        current={look.floor}
        label={(f) => FLOOR_LABEL[f]}
        title={() => t('waterfall.look.floor.title')}
        onPick={(floor) => onChange({ floor })}
      />
      <Chips
        name={t('waterfall.look.res.aria')}
        values={RESOLUTIONS}
        current={look.resolution}
        label={(r) => RES_LABEL[r]}
        title={resTitle}
        onPick={(resolution) => onChange({ resolution })}
      />
      <Chips
        name={t('waterfall.look.sharpen.aria')}
        values={SHARPENS}
        current={look.sharpen}
        label={sharpenLabel}
        title={() => t('waterfall.look.sharpen.title')}
        onPick={(sharpen) => onChange({ sharpen })}
      />
      <Chips
        name={t('waterfall.look.smooth.aria')}
        values={SMOOTHINGS}
        current={look.smoothing}
        label={smoothLabel}
        title={smoothTitle}
        onPick={(smoothing) => onChange({ smoothing })}
      />
      <Chips
        name={t('waterfall.look.edges.aria')}
        values={EDGES}
        current={look.edges}
        label={edgeLabel}
        title={edgeTitle}
        onPick={(edges) => onChange({ edges })}
      />
      <Chips
        name={t('waterfall.look.speed.aria')}
        values={SPEEDS}
        current={look.speed}
        label={speedLabel}
        title={() => t('waterfall.look.speed.title')}
        onPick={(speed) => onChange({ speed })}
      />
      {threeD && (
        <>
          <Chips
            name={t('waterfall.look.threeD.style.aria')}
            values={STYLES_3D}
            current={look.style3d}
            label={style3dLabel}
            title={style3dTitle}
            onPick={(style3d) => onChange({ style3d })}
          />
          <Chips
            name={t('waterfall.look.threeD.height.aria')}
            values={HEIGHTS_3D}
            current={look.height3d}
            label={heightLabel}
            title={heightTitle}
            onPick={(height3d) => onChange({ height3d })}
          />
          <Chips
            name={t('waterfall.look.threeD.impulse.aria')}
            values={ON_OFF}
            current={look.impulse3d}
            label={impulseLabel}
            title={() => t('waterfall.look.threeD.impulse.title')}
            onPick={(impulse3d) => onChange({ impulse3d })}
          />
          <Chips
            name={t('waterfall.look.threeD.detail.aria')}
            values={DETAILS_3D}
            current={look.detail3d}
            label={detailLabel}
            title={detailTitle}
            onPick={(detail3d) => onChange({ detail3d })}
          />
        </>
      )}
    </div>
  )
}
