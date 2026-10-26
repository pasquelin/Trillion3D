import {
  readSingleLayerWaterSetting,
  type SingleLayerWaterOptions,
} from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import type { WaterFrontSettings } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** Whether the water's settings have its reflection trace the scene: the water is on and its technique is
 *  `'enabled'` or `'screenSpace'` (`'captures'` and `'disabled'` trace nothing). */
export const waterTraces = (rt: { context: SingleLayerWaterOptions }) => {
  const technique = readSingleLayerWaterSetting(rt, 'singleLayerWaterReflection')
  return (
    readSingleLayerWaterSetting(rt, 'singleLayerWater') &&
    technique !== 'disabled' &&
    technique !== 'captures'
  )
}

/** The front layer's trace as the water's settings make it, written into one object that each ask rewrites (the reader copies what it keeps). The technique `'enabled'` traces blocks of
 *  `singleLayerWaterReflectionDownsample` pixels a side — of one row with `singleLayerWaterReflectionCheckerboard`—,
 *  its reconstruction as `singleLayerWaterReflectionReconstruction` says, its temporal and bilateral passes as
 *  `singleLayerWaterReflectionDenoising` says. The technique `'screenSpace'` is the screen's march alone, at the
 *  full resolution: no scene ray, no far screen trace, no reconstruction nor bilateral pass, its temporal pass the
 *  one `singleLayerWaterReflectionTemporal` runs. */
const front: { -readonly [K in keyof WaterFrontSettings]: WaterFrontSettings[K] } & {
  block: [number, number]
} = {
  block: [1, 1],
  reconstruction: false,
  temporal: false,
  bilateral: false,
  sceneTraces: true,
  distantTraces: true,
}
const waterFront = (rt: { context: SingleLayerWaterOptions }): WaterFrontSettings => {
  const read = (field: Parameters<typeof readSingleLayerWaterSetting>[1]) =>
    readSingleLayerWaterSetting(rt, field)
  const screen = read('singleLayerWaterReflection') === 'screenSpace'
  const side = screen ? 1 : (read('singleLayerWaterReflectionDownsample') as number)
  const denoising = read('singleLayerWaterReflectionDenoising') as boolean
  front.block[0] = side
  front.block[1] = !screen && read('singleLayerWaterReflectionCheckerboard') ? 1 : side
  front.reconstruction = !screen && (read('singleLayerWaterReflectionReconstruction') as boolean)
  front.temporal = screen ? (read('singleLayerWaterReflectionTemporal') as boolean) : denoising
  front.bilateral = !screen && denoising
  front.sceneTraces = !screen
  front.distantTraces = !screen
  return front
}

/**
 * WHAT THE SCENE'S WATER ASKS OF THE FRONT LAYER, or nothing: the plan holds a single-layer water whose
 * settings trace the scene (`waterTraces`). This is the water's gate on the reflections' indirect light: the
 * trace answers the nearest covering transparent surface as the opaque one, where the level traces, whatever
 * `reflectionFrontLayer` says (`resolveReflections`), in blocks of the side
 * `singleLayerWaterReflectionDownsample` says, its reconstruction and denoising on as the water's settings leave
 * them, and the water's fragment reads the radiance it wrote (`surfaceReflection`). Read by the front
 * pass and the trace's frame; the compile of the front stage asks `waterTraces` of the items it is made for.
 */
export const waterFrontOf = (
  rt: Pick<WebgpuPagesRuntime, 'blendState' | 'context'>,
): WaterFrontSettings | undefined =>
  rt.blendState.water && waterTraces(rt) ? waterFront(rt) : undefined
