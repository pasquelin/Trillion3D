// The projection's masks (`engineVsm.ts`), the opaque surfaces': the suns' array, a layer a sun, and the
// local lights' texture, a texel a pixel, made whole or not at all at the targets' size, and the bytes
// they take.
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { constructGpuResources } from '../../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import { onePassMaskFormat, VSM_SUN_MASK_FORMAT } from '../projection/maskFormat.ts'
import type { EngineVsm } from './engineVsm.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { viewGpu, type WebgpuView } from '../../../../frame/backend/state/view.ts'

/** What the masks are made for: the suns the frame shadows (a layer each, one at least) and the most
 *  local lights a pixel keeps (`shadowOnePassProjectionMaxLightsPerPixel`, which sets the format of the
 *  local lights' mask). */
export interface VsmMaskNeeds {
  suns: number
  localLights: number
}

/** The projection's masks, made and freed as one (`ensureMask`): the suns' array and the local lights'
 *  texture, each with the one view the projection and the lighting bind. */
export interface VsmMask {
  suns: GPUTexture
  sunsView: GPUTextureView
  locals: GPUTexture
  localsView: GPUTextureView
  localFormat: ReturnType<typeof onePassMaskFormat>
}

const sunLayers = (suns: number) => Math.max(1, suns)

const sunsDescriptor = (width: number, height: number, suns: number) => ({
  label: 'vsm.engine.sunMask',
  size: [width, height, sunLayers(suns)],
  format: VSM_SUN_MASK_FORMAT,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

const localsDescriptor = (width: number, height: number, localLights: number) => ({
  label: 'vsm.engine.localMask',
  size: [width, height],
  format: onePassMaskFormat(localLights),
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** Bytes of the masks `ensureMask` makes for `needs` at `width` × `height`. */
const maskBytes = (width: number, height: number, needs: VsmMaskNeeds) =>
  textureBytesOf(sunsDescriptor(width, height, needs.suns))! +
  textureBytesOf(localsDescriptor(width, height, needs.localLights))!

/** Bytes `mask` holds: its two textures. */
const slotBytes = (mask: VsmMask | undefined) =>
  mask ? madeTextureBytes(mask.suns) + madeTextureBytes(mask.locals) : 0

/** Bytes the masks of `vsm` hold. */
export const heldMaskBytes = (vsm: EngineVsm) => slotBytes(vsm.mask)

export const destroyMask = (mask: VsmMask | undefined) => {
  mask?.suns.destroy()
  mask?.locals.destroy()
}

/** Bytes the masks ask beyond the ones `vsm` holds, to be made at `width` × `height` for exactly
 *  `needs` (`ensureMask` frees the held ones first). */
function maskGrowth(vsm: EngineVsm, width: number, height: number, needs: VsmMaskNeeds) {
  const held = vsm.mask
  const keepSuns = !!held && fitsSuns(held.suns, width, height, needs.suns, true),
    keepLocals = !!held && fitsLocals(held, width, height, needs.localLights, true)
  if (keepSuns && keepLocals) return 0
  return maskBytes(width, height, needs) - heldMaskBytes(vsm)
}

/** Whether the suns' array holds `suns` layers over `width` × `height`: exactly when `exact`, else at
 *  least. */
const fitsSuns = (
  texture: GPUTexture,
  width: number,
  height: number,
  suns: number,
  exact: boolean,
) =>
  exact
    ? texture.width === width &&
      texture.height === height &&
      texture.depthOrArrayLayers === sunLayers(suns)
    : texture.width >= width &&
      texture.height >= height &&
      texture.depthOrArrayLayers >= sunLayers(suns)

/** Whether the local lights' texture is of the format `localLights` asks over `width` × `height`:
 *  exactly when `exact`, else at least the size. */
const fitsLocals = (
  mask: VsmMask,
  width: number,
  height: number,
  localLights: number,
  exact: boolean,
) =>
  mask.localFormat === onePassMaskFormat(localLights) &&
  (exact
    ? mask.locals.width === width && mask.locals.height === height
    : mask.locals.width >= width && mask.locals.height >= height)

/** The masks at the targets' size at least for `needs` at least — `exact` when the plan reserves them
 *  for every casting light (`reserveProjection`, `vsmBeside.ts`), the frame then drawing into as many as
 *  its own lights take —, made whole or not at all (`constructGpuResources`). Each of its textures that
 *  still serves is kept. Their texels are read at the pixel's own coordinates, so views of other shapes
 *  drawn in turn (`world.addView`) share the largest. */
export function ensureMask(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  needs: VsmMaskNeeds,
  exact = false,
): VsmMask {
  const held = vsm.mask
  const keepSuns = !!held && fitsSuns(held.suns, width, height, needs.suns, exact),
    keepLocals = !!held && fitsLocals(held, width, height, needs.localLights, exact)
  if (held && keepSuns && keepLocals) return held
  // Never a retired texture left in place should the new ones be refused (`ledgerTentative`).
  vsm.mask = undefined
  if (held) retireMask(device, held, !keepSuns, !keepLocals)
  try {
    return (vsm.mask = constructGpuResources(device, () => {
      const suns = keepSuns
        ? held!.suns
        : device.createTexture(sunsDescriptor(width, height, needs.suns))
      const locals = keepLocals
        ? held!.locals
        : device.createTexture(localsDescriptor(width, height, needs.localLights))
      return {
        suns,
        sunsView: keepSuns ? held!.sunsView : arrayView(suns),
        locals,
        localsView: keepLocals ? held!.localsView : locals.createView(),
        localFormat: onePassMaskFormat(needs.localLights),
      }
    }))
  } catch (error) {
    // Refused: the masks are made whole or not at all, and what they kept goes with them.
    if (held) retireMask(device, held, keepSuns, keepLocals)
    throw error
  }
}

/** Retires the textures of `mask` each flag names: they may be named by this image's commands, so
 *  destroyed after the submit. */
function retireMask(device: GPUDevice, mask: VsmMask, suns: boolean, locals: boolean) {
  if (suns) retire(device, mask.suns)
  if (locals) retire(device, mask.locals)
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

/** Bytes the frame's masks for `needs` at `width` × `height` ask beyond the ones `vsm` holds
 *  (`maskGrowth`), all of them without a set. */
export const masksGrowth = (
  vsm: EngineVsm | undefined,
  width: number,
  height: number,
  needs: VsmMaskNeeds,
) => (vsm ? maskGrowth(vsm, width, height, needs) : maskBytes(width, height, needs))

/** The frame's masks made exactly at `width` × `height` — every view's largest targets
 *  (`sharedMaskSize`) — for `needs` (`ensureMask`). */
export function ensureMasks(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  needs: VsmMaskNeeds,
) {
  ensureMask(device, vsm, width, height, needs, true)
}
