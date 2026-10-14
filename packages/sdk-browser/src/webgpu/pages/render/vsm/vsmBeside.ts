// What a shadow set takes beside its pool: the maps' own buffers, the passes' state, the mask,
// the raster's lists and the coloured atlas, which the grant sets aside before it draws the pool
// (`vsmGrant.ts`), and the projection's reserve each frame makes before any other shadow bytes.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { vsmTransmissionContextBytes } from '../../../../vsm/transmissionContext.ts'
import { vsmTransmissionFloorBytes } from '../../../../vsm/transmissionBinPlan.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { vsmPmContextBytes } from '../../../../vsm/pageManagementPass.ts'
import { vsmProjectionBytesToMake, vsmProjectionReserve } from '../../../../vsm/projectionPass.ts'
import { VSM_CAST_PARAMS_BYTES } from '../../../../vsm/castInvalidationWgsl.ts'
import { outOfMemoryContext } from '../../../../residency/outOfMemory.ts'
import {
  castingCount,
  directionalCount,
  engineVsmOptions,
  fullMapsFor,
  renderViewBound,
} from './vsmLightMaps.ts'
import { engineVsmSideBytes, type EngineVsm } from './engineVsm.ts'
import { ensureMask, maskBytes, maskGrowth, maskLayersFor } from './vsmMask.ts'
import { vsmRenderContextBytes } from '../../../../vsm/renderPass.ts'
import { vsmRenderFloorBytes } from '../../../../vsm/renderBudget.ts'
import { vsmLayout, type VsmLayout } from '../../../../vsm/layout.ts'
import { vsmResourceBytes } from '../../../../vsm/layoutBytes.ts'
import { vsmTransmissionBytes } from '../../../../vsm/transmissionLayout.ts'

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
 * Without `mask`, all but the mask, which a frame's own size sets (`vsmAskedBytes`).
 */
export function bytesBeside(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
  layout: VsmLayout,
  held: HeldBeside,
  mask = true,
) {
  const [width, height] = rt.gpu.allocatedSize
  const { viewWords, viewMips } = renderViewBound(lights)
  const pages = layout.poolPages
  const casters = rt.layout.rows,
    used = rt.services.blendCasters.used
  const raster = vsmRenderFloorBytes(device.limits, casters.packedCount, viewWords, viewMips, pages)
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
    (mask ? maskBytes(width, height, casting) : 0) +
    Math.max(held.lists, raster) +
    transmission
  )
}

/** The layout of the first set of `lights` (`grantEngineVsm`, from `planVsmFrame`): the maps they
 *  want at every physical page. */
export const vsmFirstSetLayout = (lights: readonly VsmFrameLight[]) =>
  vsmLayout(engineVsmOptions(fullMapsFor(lights), directionalCount(lights)))

/** Bytes the first set of `lights` takes as the first lit frame asks it (`grantEngineVsm`, from
 *  `planVsmFrame`) — the maps they want at every physical page — with what the frame makes beside
 *  it but the mask (`bytesBeside`): what the budget reserves for it before the pools. */
export function vsmSetBytes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
) {
  const layout = vsmFirstSetLayout(lights)
  return (
    vsmResourceBytes(layout) + bytesBeside(rt, device, lights, layout, heldBeside(undefined), false)
  )
}

/**
 * Makes what the frame projects with before any other shadow allocation of the frame — the mask
 * array, a layer per four casting lights, the projection's view uniforms and blue noise
 * — when the budget's room holds what they grow by: a larger canvas, more casting lights
 * (`maskGrowth`). The lists the raster then grows within the room cannot take theirs. Past it the
 * lights read no shadow this frame, said once a set, and the next frames ask again.
 */
export function reserveProjection(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  vsm: EngineVsm,
  list: readonly VsmFrameLight[],
) {
  const [width, height] = rt.gpu.allocatedSize
  const lights = castingCount(list),
    layers = maskLayersFor(lights)
  const growth = maskGrowth(vsm, width, height, lights) + vsmProjectionBytesToMake(vsm.res)
  if (growth <= 0 || growth <= ledgerRoom(device)) {
    ensureMask(device, vsm, width, height, layers, true)
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
