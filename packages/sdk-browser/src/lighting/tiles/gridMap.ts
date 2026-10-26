import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { sliceParams } from '../fog/layout.ts'
import { lightGridFar } from './gridFar.ts'

/**
 * THE LIGHT GRID'S SLICE MAP of an image: the slice of a view depth is `log2(depth · B + O) · S`
 * (`gridSlice`, `../direct/lightWgsl.ts`), `S` the setting `gridDepthDistribution`, `B` and `O` those
 * that start the first slice a little past the near plane and the last, the one `gridSlices` less one,
 * a little past the depth the farthest light reaches (the fog volume's own slices, `sliceParams`). A
 * light and a pixel past it are in that last slice, so nothing it lists is lost. The shader reads the
 * depth as the near plane over its reverse-Z `z`, so the map it is handed holds `near · B`.
 */

/** What is added to the farthest reach, in metres: the last slice starts past it. */
const FAR_MARGIN = 0.1

/** The map's four head words of the grid's buffer into `out`: `near · B`, `O`, `S`, then a spare. */
export function writeGridMap(
  out: Float32Array,
  store: SceneLightStore,
  eye: ArrayLike<number>,
  forward: ArrayLike<number>,
  near: number,
) {
  const far = lightGridFar(store, eye, forward, near) + FAR_MARGIN
  const { gridDepthDistribution, gridSlices } = LIGHT_SETTINGS
  const { b, o, s } = sliceParams(near, far, gridDepthDistribution, gridSlices - 1)
  out[0] = near * b
  out[1] = o
  out[2] = s
  out[3] = 0
}
