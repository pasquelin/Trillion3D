/**
 * THE PIXEL THE DEBUG VIEWS INSPECT: `sampledLightsDebugCursorX` and `…Y` of the view, the middle of the image on an axis where none is set (-1), held inside the image.
 */
import { SAMPLED_LIGHTS_RULES } from '../../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import { readSetting } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The pixel of an image of `size` the debug cursor names, on one axis: the setting `value`, or the middle where it is -1. */
const cursorAxis = (value: number, size: number) =>
  Math.min(value >= 0 ? value : Math.floor(size / 2), Math.max(size - 1, 0))

/** The pixel of an image of `size` the debug cursor of the view `rt` shows names. */
export const debugCursor = (rt: WebgpuPagesRuntime, size: readonly [number, number]) =>
  [
    cursorAxis(readSetting(SAMPLED_LIGHTS_RULES, rt.context, 'sampledLightsDebugCursorX'), size[0]),
    cursorAxis(readSetting(SAMPLED_LIGHTS_RULES, rt.context, 'sampledLightsDebugCursorY'), size[1]),
  ] as const
