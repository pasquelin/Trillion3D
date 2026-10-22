// What a shadow set takes beside its pool: the maps' own buffers, the passes' state, the mask,
// the raster's lists and the coloured atlas, which the grant sets aside before it draws the pool
// (`vsmGrant.ts`), and the projection's reserve each frame makes before any other shadow bytes.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { vsmTransmissionContextBytes } from '../transmission/transmissionContext.ts'
import { vsmTransmissionFloorBytes } from '../transmission/transmissionBinPlan.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { vsmPmContextBytes } from '../pageManagementPass.ts'
import { vsmProjectionBytesToMake, vsmProjectionReserve } from '../projection/projectionStore.ts'
import { VSM_CAST_PARAMS_BYTES } from '../invalidation/castInvalidationWgsl.ts'
import { outOfMemoryContext } from '../../../../session/memory/outOfMemory.ts'
import {
  castingCount,
  directionalCount,
  engineVsmOptions,
  fullMapsFor,
  renderViewBound,
  vsmPoolAsked,
} from './vsmLightMaps.ts'
import { engineVsmSideBytes, type EngineVsm } from './engineVsm.ts'
import { ensureMasks, masksGrowth, sharedMaskSize } from './vsmMask.ts'
import { vsmRenderContextBytes } from '../render/renderPass.ts'
import { vsmRenderFloorBytes } from '../render/renderBudget.ts'
import { vsmViewsPerPass } from '../render/renderViewPasses.ts'
import { shadowSetting } from './vsmFarShadow.ts'
import { vsmLayout, type VsmLayout } from '../layout.ts'
import { vsmResourceBytes } from '../layoutBytes.ts'
import { vsmTransmissionBytes } from '../transmission/transmissionLayout.ts'

/** What the replaced set held of what a frame grows: its raster lists, and its coloured atlas with
 *  its draw context — measured before it is freed (`heldBeside`). */
type HeldBeside = { lists: number; transmission: number }

export const heldBeside = (vsm: EngineVsm | undefined): HeldBeside => ({
  lists: vsm ? vsmRenderContextBytes(vsm.res) : 0,
  transmission: vsm?.transmission
    ? vsm.transmission.bytes + vsmTransmissionContextBytes(vsm.transmission)
    : 0,
})

/**
 * Bytes the frame makes beside a set of `layout`: the maps' own buffers beside the set
 * (`engineVsmSideBytes`) and the passes' own state; the projection's mask at the targets' size, a
 * layer per four casting lights; the raster's draw context as large as the replaced set's, and
 * never under the least that draws every caster row (`vsmRenderFloorBytes`); and, while a blended
 * caster casts, the coloured atlas as large as the replaced set's, never under the first one and
 * its least draw context. The lists grow past these only within the room (`vsmChunkRowsWithin`).
 * Without `mask`, all but the masks, which a frame's own size sets (`vsmAskedBytes`).
 */
export function bytesBeside(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
  layout: VsmLayout,
  held: HeldBeside,
  mask = true,
) {
  const [width, height] = sharedMaskSize(rt, ...rt.gpu.allocatedSize)
  const limit = vsmViewsPerPass(device.limits, shadowSetting(rt, 'shadowMultipassViews'))
  const { viewWords, viewMips, raster: views } = renderViewBound(lights, limit)
  const pages = layout.poolPages
  const casters = rt.layout.rows,
    used = rt.services.blendCasters.used
  const raster = vsmRenderFloorBytes(
    device.limits,
    casters.packedCount,
    views.viewWords,
    views.viewMips,
    pages,
    views.passes,
  )
  const blended = Math.max(0, casters.casterSlots - casters.blendFirst)
  const transmission =
    used > 0
      ? Math.max(
          held.transmission,
          vsmTransmissionBytes(layout) +
            vsmTransmissionFloorBytes(device.limits, used, blended, viewWords, viewMips, pages),
        )
      : 0
  const casting = castingCount(lights)
  // The passes' own state a new set makes: its page management, its projection's views and blue
  // noise, the invalidation's first parameters.
  const passes =
    vsmPmContextBytes(device.limits) + vsmProjectionBytesToMake(undefined) + VSM_CAST_PARAMS_BYTES
  return (
    engineVsmSideBytes(device.limits) +
    passes +
    (mask ? masksGrowth(undefined, width, height, casting) : 0) +
    Math.max(held.lists, raster) +
    transmission
  )
}

/** The layout of the first set of `lights` (`grantEngineVsm`, from `planVsmFrame`): the maps they
 *  want at every physical page the view asks (`vsmPoolAsked`). */
export const vsmFirstSetLayout = (rt: WebgpuPagesRuntime, lights: readonly VsmFrameLight[]) =>
  vsmLayout(engineVsmOptions(fullMapsFor(lights), directionalCount(lights), vsmPoolAsked(rt)))

/** Bytes the first set of `lights` takes as the first lit frame asks it (`grantEngineVsm`, from
 *  `planVsmFrame`) — the maps they want at every physical page — with what the frame makes beside
 *  it but the mask (`bytesBeside`): what the budget reserves for it before the pools. */
export function vsmSetBytes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
) {
  const layout = vsmFirstSetLayout(rt, lights)
  return (
    vsmResourceBytes(layout) + bytesBeside(rt, device, lights, layout, heldBeside(undefined), false)
  )
}

/**
 * Makes what the frame projects with before any other shadow allocation of the frame — the mask,
 * a layer per four casting lights, the projection's view uniforms and blue noise — when the
 * budget's room holds what they grow by: a larger canvas, more casting lights (`masksGrowth`). The
 * lists the raster then grows within the room cannot take theirs. Past it the lights read no
 * shadow this frame, said once a set, and the next frames ask again.
 */
export function reserveProjection(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  vsm: EngineVsm,
  list: readonly VsmFrameLight[],
) {
  const [width, height] = sharedMaskSize(rt, ...rt.gpu.allocatedSize)
  const lights = castingCount(list)
  const growth = masksGrowth(vsm, width, height, lights) + vsmProjectionBytesToMake(vsm.res)
  if (growth <= 0 || growth <= ledgerRoom(device)) {
    ensureMasks(device, vsm, width, height, lights)
    vsmProjectionReserve(device, vsm.res)
    return true
  }
  if (!vsm.said.has('mask')) {
    vsm.said.add('mask')
    rt.diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The GPU budget holds no shadow mask at this size: the lights cast no shadow',
      outOfMemoryContext('shadow', growth),
    )
  }
  return false
}
