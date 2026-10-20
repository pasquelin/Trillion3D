// The projection's mask (`engineVsm.ts`), the opaque surfaces': its array, a layer per four
// shadowed lights, its tile words and, with translucent casters, its transmission, a layer a light,
// made whole or not at all at the targets' size, and the bytes it takes.
import { workgroupCount } from '../../../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { constructGpuResources } from '../../../../gpu/core/errorScope.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import {
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_THROUGH_FORMAT,
  VSM_PROJECTION_TILE_FORMAT,
  vsmProjectionTiles,
} from '../projection/projectionWgsl.ts'
import { VSM_PROJECTION_MAX_LIGHTS } from '../constants.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../projection/projectionView.ts'
import type { EngineVsm } from './engineVsm.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { viewGpu, type WebgpuView } from '../../../../frame/backend/state/view.ts'

/** The projection's mask, made and freed as one (`ensureMask`): its array, a layer per four
 *  shadowed lights, its tile words, a texel per projection group naming the layers it stored, and,
 *  while the frame holds translucent casters, what their panes let through along each light's
 *  missed rays (`through`, a layer a light), each with the one view the projection and the
 *  lighting bind. */
export interface VsmMask {
  array: GPUTexture
  view: GPUTextureView
  tiles: GPUTexture
  tilesView: GPUTextureView
  through?: GPUTexture
  throughView?: GPUTextureView
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

/** The transmission's layers for `lights` shadowed lights: one a light the projection reads. */
const throughLayersFor = (lights: number) => clampLowWins(lights, 1, VSM_PROJECTION_MAX_PASS_LIGHTS)

const throughDescriptor = (width: number, height: number, lights: number) => ({
  label: 'vsm.engine.shadowThrough',
  size: [width, height, throughLayersFor(lights)],
  format: VSM_PROJECTION_THROUGH_FORMAT,
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
 *  array, its tile words and, with translucent casters (`transmits`), its transmission. */
const maskBytes = (width: number, height: number, lights: number, transmits: boolean) =>
  textureBytesOf(maskDescriptor(width, height, maskLayersFor(lights)))! +
  textureBytesOf(maskTilesDescriptor(width, height))! +
  (transmits ? textureBytesOf(throughDescriptor(width, height, lights))! : 0)

/** Bytes `mask` holds: its array, its tile words and its transmission, none without one. */
const slotBytes = (mask: VsmMask | undefined) =>
  mask
    ? madeTextureBytes(mask.array) +
      madeTextureBytes(mask.tiles) +
      (mask.through ? madeTextureBytes(mask.through) : 0)
    : 0

/** Bytes the mask of `vsm` holds: its array and its tile words. */
export const heldMaskBytes = (vsm: EngineVsm) => slotBytes(vsm.mask)

export const destroyMask = (mask: VsmMask | undefined) => {
  mask?.array.destroy()
  mask?.tiles.destroy()
  mask?.through?.destroy()
}

/** Whether the frame of `vsm` holds translucent casters: its mask then carries their transmission. */
const transmitsOf = (vsm: EngineVsm) => !!vsm.transmission

/** Bytes the mask asks beyond the one `vsm` holds, to be made at `width` × `height` for exactly
 *  `lights` shadowed lights (`ensureMask` frees the held one first). */
function maskGrowth(vsm: EngineVsm, width: number, height: number, lights: number) {
  const transmits = transmitsOf(vsm)
  if (maskKept(vsm.mask, width, height, lights, transmits, true)) return 0
  return maskBytes(width, height, lights, transmits) - heldMaskBytes(vsm)
}

/** Whether `texture` holds `layers` layers over `width` × `height`: exactly when `exact`, else at
 *  least. */
const fits = (
  texture: GPUTexture,
  width: number,
  height: number,
  layers: number,
  exact: boolean,
) =>
  exact
    ? texture.width === width && texture.height === height && texture.depthOrArrayLayers === layers
    : texture.width >= width && texture.height >= height && texture.depthOrArrayLayers >= layers

/** Whether `mask` serves `lights` shadowed lights over `width` × `height`, its transmission held
 *  exactly while the frame `transmits`: exactly when `exact` (the plan's reservation at the targets'
 *  size, so a mask shrinks with them), else at least — its texels are read at the pixel's own
 *  coordinates, so views of other shapes drawn in turn (`world.addView`) share the largest. */
const maskKept = (
  mask: VsmMask | undefined,
  width: number,
  height: number,
  lights: number,
  transmits: boolean,
  exact: boolean,
) =>
  !!mask &&
  fits(mask.array, width, height, maskLayersFor(lights), exact) &&
  (mask.through
    ? transmits && fits(mask.through, width, height, throughLayersFor(lights), exact)
    : !transmits)

/** The mask at the targets' size at least for `lights` shadowed lights at least, its transmission
 *  while the frame holds translucent casters — `exact` when the plan reserves it for every casting
 *  light (`reserveProjection`, `vsmBeside.ts`), the frame then drawing into as many as its own
 *  lights take —, made whole or not at all (`constructGpuResources`). Each of its textures that
 *  still serves is kept: a count of translucent lights that moves remakes the transmission alone,
 *  a count that keeps its layers of four the array and its tiles. */
export function ensureMask(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  lights: number,
  exact = false,
): VsmMask {
  const held = vsm.mask,
    transmits = transmitsOf(vsm)
  const keepArray = !!held && fits(held.array, width, height, maskLayersFor(lights), exact),
    keepTiles = !!held && fits(held.tiles, ...vsmProjectionTiles(width, height), 1, exact),
    keepThrough = held?.through
      ? transmits && fits(held.through, width, height, throughLayersFor(lights), exact)
      : !transmits
  if (held && keepArray && keepTiles && keepThrough) return held
  // Never a retired texture left in place should the new ones be refused (`ledgerTentative`).
  vsm.mask = undefined
  if (held) retireMask(device, held, !keepArray, !keepTiles, !keepThrough)
  try {
    return (vsm.mask = constructGpuResources(device, () => {
      const array = keepArray
        ? held!.array
        : device.createTexture(maskDescriptor(width, height, maskLayersFor(lights)))
      const tiles = keepTiles
        ? held!.tiles
        : device.createTexture(maskTilesDescriptor(width, height))
      const through = !transmits
        ? undefined
        : keepThrough
          ? held!.through
          : device.createTexture(throughDescriptor(width, height, lights))
      return {
        array,
        view: keepArray ? held!.view : arrayView(array),
        tiles,
        tilesView: keepTiles ? held!.tilesView : tiles.createView(),
        through,
        throughView: keepThrough && through ? held!.throughView : through && arrayView(through),
      }
    }))
  } catch (error) {
    // Refused: the mask is made whole or not at all, and what it kept goes with it.
    if (held) retireMask(device, held, keepArray, keepTiles, keepThrough)
    throw error
  }
}

/** Retires the textures of `mask` each flag names: they may be named by this image's commands, so
 *  destroyed after the submit. */
function retireMask(
  device: GPUDevice,
  mask: VsmMask,
  array: boolean,
  tiles: boolean,
  through: boolean,
) {
  if (array) retire(device, mask.array)
  if (tiles) retire(device, mask.tiles)
  if (through && mask.through) retire(device, mask.through)
}

/** The one size `sharedMaskSize` answers with: read at once, so a frame allocates none. */
const sharedSize: [number, number] = [0, 0]

/** Widens `sharedSize` to the targets `view` holds, unless it is the drawn one, whose targets
 *  are the size asked. */
function widenTo(rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>, view: WebgpuView) {
  if (view === rt.views.active) return
  const [width, height] = viewGpu(rt, view).allocatedSize
  sharedSize[0] = Math.max(sharedSize[0], width)
  sharedSize[1] = Math.max(sharedSize[1], height)
}

/** The size the frame's mask is made at exactly for the drawn view's targets at `width` ×
 *  `height`: the largest of theirs and every other view's — its texels are read at the pixel's own
 *  coordinates (`maskKept`), so views of other shapes drawn in turn (`world.addView`) each find it
 *  whole and none remakes it, and it still shrinks once they all do. Read at once: one tuple
 *  serves every call. */
export function sharedMaskSize(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>,
  width: number,
  height: number,
): readonly [number, number] {
  sharedSize[0] = width
  sharedSize[1] = height
  widenTo(rt, rt.views.main)
  for (const view of rt.views.persistent) widenTo(rt, view)
  return sharedSize
}

/** Bytes the frame's mask for `lights` shadowed lights at `width` × `height` asks beyond the one
 *  `vsm` holds (`maskGrowth`), all of it without a set. */
export const masksGrowth = (
  vsm: EngineVsm | undefined,
  width: number,
  height: number,
  lights: number,
) => (vsm ? maskGrowth(vsm, width, height, lights) : maskBytes(width, height, lights, false))

/** The frame's mask made exactly at `width` × `height` — every view's largest targets
 *  (`sharedMaskSize`) — for `lights` shadowed lights (`ensureMask`). */
export function ensureMasks(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  lights: number,
) {
  ensureMask(device, vsm, width, height, lights, true)
}
