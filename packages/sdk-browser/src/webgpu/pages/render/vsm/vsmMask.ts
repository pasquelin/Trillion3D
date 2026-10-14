// The projection's mask (`engineVsm.ts`): its array, a layer per four shadowed lights, and its tile
// words, made whole or not at all at the targets' size, and the bytes it takes.
import { workgroupCount } from '../../../../../../math/src/scalar/integers.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { constructGpuResources } from '../../../../gpu/core/errorScope.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import {
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_MAX_LIGHTS,
  VSM_PROJECTION_TILE_FORMAT,
  vsmProjectionTiles,
} from '../../../../vsm/projectionWgsl.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../../../../vsm/projectionView.ts'
import type { EngineVsm } from './engineVsm.ts'

/** The projection's mask, made and freed as one (`ensureMask`): its array, a layer per four
 *  shadowed lights, and its tile words, a texel per projection group naming the layers it stored,
 *  each with the one view the projection and the lighting bind. */
export interface VsmMask {
  array: GPUTexture
  view: GPUTextureView
  tiles: GPUTexture
  tilesView: GPUTextureView
}

/** The mask array's layers for `lights` shadowed lights: one per four, one at least, and no more
 *  than the projection's one pass reads (`VSM_PROJECTION_MAX_PASS_LIGHTS`, `vsmProject.ts`). */
export const maskLayersFor = (lights: number) =>
  workgroupCount(Math.min(lights, VSM_PROJECTION_MAX_PASS_LIGHTS), VSM_PROJECTION_MAX_LIGHTS)

const maskDescriptor = (width: number, height: number, layers: number) => ({
  label: 'vsm.engine.shadowMask',
  size: [width, height, layers],
  format: VSM_PROJECTION_MASK_FORMAT,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** The mask's tile words at `width` × `height`: a texel per projection group. */
const maskTilesDescriptor = (width: number, height: number) => ({
  label: 'vsm.engine.shadowMaskTiles',
  size: vsmProjectionTiles(width, height),
  format: VSM_PROJECTION_TILE_FORMAT,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** Bytes of the mask `ensureMask` makes for `lights` shadowed lights at `width` × `height`: its
 *  array and its tile words. */
export const maskBytes = (width: number, height: number, lights: number) =>
  textureBytesOf(maskDescriptor(width, height, maskLayersFor(lights)))! +
  textureBytesOf(maskTilesDescriptor(width, height))!

/** Bytes the mask `vsm` holds: its array and its tile words. */
export const heldMaskBytes = ({ mask }: EngineVsm) =>
  mask ? madeTextureBytes(mask.array) + madeTextureBytes(mask.tiles) : 0

export const destroyMask = (mask: VsmMask | undefined) => {
  mask?.array.destroy()
  mask?.tiles.destroy()
}

/** Bytes the mask asks beyond the one `vsm` holds, to be made at `width` × `height` for exactly
 *  `lights` shadowed lights (`ensureMask` frees the held one first). */
export function maskGrowth(vsm: EngineVsm, width: number, height: number, lights: number) {
  if (maskKept(vsm, width, height, maskLayersFor(lights), true)) return 0
  return maskBytes(width, height, lights) - heldMaskBytes(vsm)
}

/** Whether the mask of `vsm` serves `layers` layers at `width` × `height`, exactly or at least. */
const maskKept = (
  { mask }: EngineVsm,
  width: number,
  height: number,
  layers: number,
  exact: boolean,
) => {
  const array = mask?.array
  return (
    !!array &&
    array.width === width &&
    array.height === height &&
    (exact ? array.depthOrArrayLayers === layers : array.depthOrArrayLayers >= layers)
  )
}

/** The mask at the targets' size, one layer per four shadowed lights at least — `exact` when the
 *  plan reserves it for every casting light (`reserveProjection`, `vsmBeside.ts`), the frame then
 *  drawing into as many as its own lights take —, made whole or not at all
 *  (`constructGpuResources`). */
export function ensureMask(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  layers: number,
  exact = false,
): VsmMask {
  if (vsm.mask && maskKept(vsm, width, height, layers, exact)) return vsm.mask
  destroyMask(vsm.mask)
  // Never a destroyed mask left in place should the new one be refused (`ledgerTentative`).
  vsm.mask = undefined
  return (vsm.mask = constructGpuResources(device, () => {
    const array = device.createTexture(maskDescriptor(width, height, layers))
    const tiles = device.createTexture(maskTilesDescriptor(width, height))
    return {
      array,
      view: arrayView(array),
      tiles,
      tilesView: tiles.createView(),
    }
  }))
}
