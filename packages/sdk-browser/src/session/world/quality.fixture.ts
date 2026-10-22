// The world quality under test: the engine's levels with two groups written as a level would, over fresh settings.
import {
  QUALITY_LEVELS,
  type QualityLevels,
} from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import { createWorldQuality, type WorldQualityOptions } from './quality.ts'
import { createWorldSettings } from './settings.ts'

export const WORLD_SETTINGS = createWorldSettings().table

/** The engine's table, with the edge smoothing's and the view distance's levels written as a level
 *  of S35 would: the mechanism is proven on values it can see. */
export const LEVELS: QualityLevels = {
  ...QUALITY_LEVELS,
  edgeSmoothing: {
    smooth: { antialiasing: 'off' },
    balanced: {},
    fine: {},
    max: {},
  },
  viewDistance: {
    smooth: { ...QUALITY_LEVELS.viewDistance.smooth, pixelError: 8 },
    balanced: { ...QUALITY_LEVELS.viewDistance.balanced, pixelError: 4 },
    fine: { ...QUALITY_LEVELS.viewDistance.fine, pixelError: 1 },
    max: {},
  },
}

export function quality(options?: WorldQualityOptions, asked: RenderScale = 'auto') {
  const settings = createWorldSettings()
  const frame = {
    last: null as { renderWidth: number | null; renderHeight: number | null } | null,
  }
  const scale = {
    asked: () => asked,
    ask: (next: RenderScale) => void (asked = next),
    drawn: () => frame.last,
  }
  return { settings, frame, quality: createWorldQuality(settings, scale, options, LEVELS) }
}
