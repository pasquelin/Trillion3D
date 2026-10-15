// The texel rule the CPU oracles of texture sampling read by: the GPU samples, the engine has no twin.
import { clamp, floorMod, saturate } from '../../../math/src/scalar/reals.ts'
import type { Texture, WrapMode } from '../../../sdk-core/src/texture/contract.ts'

/** Texel of an axis by the sampler's integer rule: mirror folds two periods. */
function wrapTexel(t: number, size: number, wrap: WrapMode) {
  const p = wrap === 'mirror' ? 2 : 1
  const scaled = wrap === 'clamp' ? saturate(t) : floorMod(t, p)
  const i = Math.floor(scaled * size)
  return clamp(i < size ? i : 2 * size - 1 - i, 0, size - 1)
}

/** Rank of the texel a map reads at an untransformed coordinate, not its components: that byte
 *  indexes the sRGB table. The `nearest` rule; a `flipY` map reads its rows from the last, as the
 *  GPU uploads them. */
export function mapTexel(
  image: { width: number; height: number },
  map: Pick<Texture, 'wrapS' | 'wrapT' | 'flipY'>,
  u: number,
  v: number,
) {
  const x = wrapTexel(u, image.width, map.wrapS),
    row = wrapTexel(v, image.height, map.wrapT),
    y = map.flipY ? image.height - 1 - row : row
  return (y * image.width + x) * 4
}
