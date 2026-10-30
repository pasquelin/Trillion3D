import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import type { VsmFrame } from './vsmProject.ts'

/**
 * A SHADOW THAT IS LAID INTO THE LIGHTS' MASKS BESIDE THE VIRTUAL MAPS' PROJECTION: the translucent object shadows today (`vsmObjectShadow.ts`). The projector walks the
 * contributors of the frame at each of the places the masks are made, instead of knowing each shadow: a local light's layer on the per-light path, the layers of the one-pass
 * path's packed lanes, the suns' mask, and the key the held projection compares.
 */
export interface MaskContributor {
  /** A local light's layer of the per-light mask, once its projection is encoded, with the rectangle of pixels it reaches (the first column and row, one past the last). */
  local?(
    encoder: GPUCommandEncoder,
    light: VsmProjectionLight,
    layer: GPUTextureView,
    rect: readonly [number, number, number, number],
  ): void
  /** The layers the one-pass path reads where it packs a light's share, a view each local light of `lights` after the suns. */
  onePassLayer?(
    frame: VsmFrame,
    encoder: GPUCommandEncoder,
    lights: readonly VsmProjectionLight[],
    layers: readonly GPUTextureView[],
  ): void
  /** The suns' mask, once the suns' projection is encoded: the first `suns` lights of `lights` are the suns, a layer each. */
  sun?(
    encoder: GPUCommandEncoder,
    lights: readonly VsmProjectionLight[],
    suns: number,
    sunMask: GPUTextureView,
  ): void
  /** What the held projection compares for this frame (`vsmProjectionHold.ts`): 0 where the contributor adds nothing, else a key that moves with what it adds. */
  readonly holdKey: number
}

/** The callback the per-light path takes of the contributors that lay a layer (`PerLightInputs.afterMask`). */
export const contributorsLocal =
  (contributors: readonly MaskContributor[]) =>
  (
    encoder: GPUCommandEncoder,
    light: VsmProjectionLight,
    layer: GPUTextureView,
    rect: readonly [number, number, number, number],
  ) => {
    for (const c of contributors) c.local?.(encoder, light, layer, rect)
  }

/** The key of the contributors the held projection compares: 0 for none. */
export function contributorsHoldKey(contributors: readonly MaskContributor[]) {
  let key = 0
  for (const c of contributors) key = (key * 31 + c.holdKey) % 2147483647
  return key
}
