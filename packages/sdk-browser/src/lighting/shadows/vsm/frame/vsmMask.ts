// The projection's masks (`engineVsm.ts`), the opaque surfaces': the suns' array, a layer a sun, and,
// by the path the local lights take (`shadowOnePassProjection`), their texture, a texel a pixel, or the
// per-light path's array, a layer a light (`perLightPass.ts`): made whole or not at all at the targets'
// size, and the bytes they take.
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { constructGpuResources } from '../../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import {
  onePassMaskFormat,
  PER_LIGHT_MASK_FORMAT,
  VSM_SUN_MASK_FORMAT,
} from '../projection/maskFormat.ts'
import type { EngineVsm } from './engineVsm.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { viewGpu, type WebgpuView } from '../../../../frame/backend/state/view.ts'

/** What the masks are made for: the suns the frame shadows (a layer each, one at least); by the path the
 *  local lights take, either (`onePass`, `shadowOnePassProjection`) the most local lights a pixel keeps
 *  (`shadowOnePassProjectionMaxLightsPerPixel`, which sets the format of their one mask), or the layers of
 *  the per-light path's mask (`perLightLayers`, none for a frame with no shadowed local light). */
export interface VsmMaskNeeds {
  suns: number
  onePass: boolean
  localLights: number
  perLightLayers: number
}

/** The per-light path's mask, an array a layer a light (`PER_LIGHT_MASK_LAYERS` at most), with the view the
 *  projection writes and the lighting reads, and a view of each layer for the clear that `shadowForcePerLightMaskClear` asks. */
export interface VsmPerLightMask {
  texture: GPUTexture
  view: GPUTextureView
  layers: GPUTextureView[]
}

/** The projection's masks, made and freed as one (`ensureMask`): the suns' array and, by the path the
 *  local lights take, their one-pass texture or the per-light path's array, each with the one view the
 *  projection and the lighting bind. */
export interface VsmMask {
  suns: GPUTexture
  sunsView: GPUTextureView
  /** The one-pass projection's local lights' mask (`localFormat`); none on the per-light path. */
  locals?: GPUTexture
  localsView?: GPUTextureView
  localFormat: ReturnType<typeof onePassMaskFormat>
  /** The per-light path's mask; none on the one-pass path, or with no shadowed local light. */
  perLight?: VsmPerLightMask
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

/** The per-light path's mask: written by the light's projection, read by its draw, and cleared by a render pass where
 *  `shadowForcePerLightMaskClear` asks. */
const perLightDescriptor = (width: number, height: number, layers: number) => ({
  label: 'vsm.engine.perLightMask',
  size: [width, height, layers],
  format: PER_LIGHT_MASK_FORMAT,
  usage:
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.RENDER_ATTACHMENT,
})

/** Bytes of the masks `ensureMask` makes for `needs` at `width` × `height`. */
const maskBytes = (width: number, height: number, needs: VsmMaskNeeds) =>
  textureBytesOf(sunsDescriptor(width, height, needs.suns))! +
  (needs.onePass
    ? textureBytesOf(localsDescriptor(width, height, needs.localLights))!
    : needs.perLightLayers
      ? textureBytesOf(perLightDescriptor(width, height, needs.perLightLayers))!
      : 0)

/** Bytes `mask` holds: its textures. */
const slotBytes = (mask: VsmMask | undefined) =>
  mask
    ? madeTextureBytes(mask.suns) +
      (mask.locals ? madeTextureBytes(mask.locals) : 0) +
      (mask.perLight ? madeTextureBytes(mask.perLight.texture) : 0)
    : 0

/** Bytes the masks of `vsm` hold. */
export const heldMaskBytes = (vsm: EngineVsm) => slotBytes(vsm.mask)

export const destroyMask = (mask: VsmMask | undefined) => {
  mask?.suns.destroy()
  mask?.locals?.destroy()
  mask?.perLight?.texture.destroy()
}

/** Bytes the masks ask beyond the ones `vsm` holds, to be made at `width` × `height` for exactly
 *  `needs` (`ensureMask` frees the held ones first). */
function maskGrowth(vsm: EngineVsm, width: number, height: number, needs: VsmMaskNeeds) {
  const held = vsm.mask
  const keepSuns = !!held && fitsSuns(held.suns, width, height, needs.suns, true),
    keepLocals = !!held && fitsLocals(held, width, height, needs, true),
    keepPerLight = !!held && fitsPerLight(held, width, height, needs, true)
  if (keepSuns && keepLocals && keepPerLight) return 0
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

/** Whether the local lights' texture is what `needs` ask over `width` × `height`: on the one-pass path of the
 *  format `localLights` asks, exactly the size when `exact`, else at least it; on the per-light path none. */
const fitsLocals = (
  mask: VsmMask,
  width: number,
  height: number,
  needs: VsmMaskNeeds,
  exact: boolean,
) => {
  const { locals } = mask
  if (!needs.onePass) return !locals
  if (!locals || mask.localFormat !== onePassMaskFormat(needs.localLights)) return false
  return exact
    ? locals.width === width && locals.height === height
    : locals.width >= width && locals.height >= height
}

/** Whether the per-light mask is what `needs` ask over `width` × `height`: none when they ask no layer or the one-pass path;
 *  else its layers exactly when `exact`, else at least them, over the size as `fitsLocals`. */
const fitsPerLight = (
  mask: VsmMask,
  width: number,
  height: number,
  needs: VsmMaskNeeds,
  exact: boolean,
) => {
  const layers = needs.onePass ? 0 : needs.perLightLayers
  const held = mask.perLight?.texture
  if (!layers) return !held
  if (!held) return false
  return exact
    ? held.width === width && held.height === height && held.depthOrArrayLayers === layers
    : held.width >= width && held.height >= height && held.depthOrArrayLayers >= layers
}

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
    keepLocals = !!held && fitsLocals(held, width, height, needs, exact),
    keepPerLight = !!held && fitsPerLight(held, width, height, needs, exact)
  if (held && keepSuns && keepLocals && keepPerLight) return held
  // Never a retired texture left in place should the new ones be refused (`ledgerTentative`).
  vsm.mask = undefined
  if (held) retireMask(device, held, !keepSuns, !keepLocals, !keepPerLight)
  try {
    return (vsm.mask = constructGpuResources(device, () => {
      const suns = keepSuns
        ? held!.suns
        : device.createTexture(sunsDescriptor(width, height, needs.suns))
      const locals = keepLocals
        ? held!.locals
        : needs.onePass
          ? device.createTexture(localsDescriptor(width, height, needs.localLights))
          : undefined
      const layers = needs.onePass ? 0 : needs.perLightLayers
      const perLight = keepPerLight
        ? held!.perLight
        : layers
          ? perLightMask(device.createTexture(perLightDescriptor(width, height, layers)), layers)
          : undefined
      return {
        suns,
        sunsView: keepSuns ? held!.sunsView : arrayView(suns),
        locals,
        localsView: keepLocals ? held!.localsView : locals?.createView(),
        localFormat: onePassMaskFormat(needs.localLights),
        perLight,
      }
    }))
  } catch (error) {
    // Refused: the masks are made whole or not at all, and what they kept goes with them.
    if (held) retireMask(device, held, keepSuns, keepLocals, keepPerLight)
    throw error
  }
}

/** The per-light mask over `texture` of `layers` layers: its array view and a view of each layer. */
const perLightMask = (texture: GPUTexture, layers: number): VsmPerLightMask => ({
  texture,
  view: arrayView(texture),
  layers: Array.from({ length: layers }, (_, layer) =>
    texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
  ),
})

/** Retires the textures of `mask` each flag names: they may be named by this image's commands, so
 *  destroyed after the submit. */
function retireMask(
  device: GPUDevice,
  mask: VsmMask,
  suns: boolean,
  locals: boolean,
  perLight: boolean,
) {
  if (suns) retire(device, mask.suns)
  if (locals && mask.locals) retire(device, mask.locals)
  if (perLight && mask.perLight) retire(device, mask.perLight.texture)
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
