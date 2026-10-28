// What a shadow set takes beside its pool: the maps' own buffers, the passes' state, the mask and
// the raster's lists, which the grant sets aside before it draws the pool
// (`vsmGrant.ts`), and the projection's reserve each frame makes before any other shadow bytes.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { vsmPmContextBytes } from '../pageManagementPass.ts'
import {
  projectionReady,
  vsmProjectionBytesToMake,
  vsmProjectionReserve,
} from '../projection/projectionStore.ts'
import { VSM_CAST_PARAMS_BYTES } from '../invalidation/castInvalidationWgsl.ts'
import { outOfMemoryContext } from '../../../../session/memory/outOfMemory.ts'
import {
  maskNeedsFor,
  sunMapsFor,
  engineVsmOptions,
  fullMapsFor,
  renderViewBound,
  reserveSetOptions,
  vsmAsked,
} from './vsmLightMaps.ts'
import { engineVsmSideBytes, type EngineVsm } from './engineVsm.ts'
import { ensureMasks, masksGrowth, sharedMaskSize } from './vsmMask.ts'
import { vsmRenderContextBytes } from '../render/renderPass.ts'
import { vsmRenderFloorBytes } from '../render/renderLists.ts'
import { vsmRenderParamSlots } from '../render/renderParams.ts'
import { vsmViewsLaid } from '../render/renderParamsWgsl.ts'
import { INITIAL_VISIBLE } from '../../../../geometry/dag/visible/layout.ts'
import { vsmViewsPerPass } from '../render/renderViewPasses.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { vsmLayout } from '../layout.ts'
import { vsmResourceBytes } from '../layoutBytes.ts'

/** The bytes of raster lists the replaced set held, which a frame grows — measured before it is
 *  freed. */
export const heldListBytes = (vsm: EngineVsm | undefined) =>
  vsm ? vsmRenderContextBytes(vsm.res) : 0

/**
 * Bytes the frame makes beside a set: the maps' own buffers beside the set
 * (`engineVsmSideBytes`) and the passes' own state; the projection's masks at the targets' size, a
 * layer a sun and a texel a pixel for the local lights; the raster's draw context as large as the replaced set's, and
 * never under its lists for every caster and the records' first room (`vsmRenderFloorBytes`,
 * `INITIAL_VISIBLE`). The lists grow past these only within the room (`encodeVsmRender`).
 * Without `mask`, all but the masks, which a frame's own size sets (`vsmAskedBytes`).
 */
export function bytesBeside(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
  heldLists: number,
  mask = true,
) {
  const [width, height] = sharedMaskSize(rt, ...rt.gpu.allocatedSize)
  const limit = vsmViewsPerPass(device.limits, readShadowSetting(rt, 'shadowMultipassViews'))
  const { lights: lightCount, raster: views } = renderViewBound(lights, limit)
  const raster = vsmRenderFloorBytes(
    vsmRenderParamSlots(device.limits),
    views.passes,
    views.mostMaps,
    views.mostMips,
    lightCount,
    rt.layout.clusters.candidateCount,
    INITIAL_VISIBLE,
    vsmViewsLaid(device),
  )
  // The passes' own state a new set makes: its page management, its projection's views and blue
  // noise, the invalidation's first parameters.
  const passes =
    vsmPmContextBytes(device.limits, readShadowSetting(rt, 'shadowPrefilteredDistant')) +
    vsmProjectionBytesToMake(undefined) +
    VSM_CAST_PARAMS_BYTES
  return (
    engineVsmSideBytes(device.limits) +
    passes +
    (mask ? masksGrowth(undefined, width, height, maskNeedsFor(rt, lights)) : 0) +
    Math.max(heldLists, raster)
  )
}

/** The layout of the first set of `lights` (`grantEngineVsm`, from `planVsmFrame`): the maps they
 *  want at every physical page the view asks (`vsmAsked`). */
export const vsmFirstSetLayout = (rt: WebgpuPagesRuntime, lights: readonly VsmFrameLight[]) =>
  vsmLayout(engineVsmOptions(fullMapsFor(lights), sunMapsFor(lights), vsmAsked(rt)))

/** The layout of the first set of a scene with no casting light yet, laid out for the one sun its page adds (`reserveSetOptions`): the shadow maps' pipelines are compiled for it at the
 *  opening. */
export const vsmReserveSetLayout = (rt: WebgpuPagesRuntime, sunLevels: number) =>
  vsmLayout(reserveSetOptions(vsmAsked(rt), sunLevels))

/** Bytes the first set of `lights` takes as the first lit frame asks it (`grantEngineVsm`, from
 *  `planVsmFrame`) — the maps they want at every physical page — with what the frame makes beside
 *  it but the mask (`bytesBeside`): what the budget reserves for it before the pools. */
export function vsmSetBytes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
) {
  const layout = vsmFirstSetLayout(rt, lights)
  return vsmResourceBytes(layout) + bytesBeside(rt, device, lights, 0, false)
}

/**
 * Makes what the frame projects with before any other shadow allocation of the frame — the masks,
 * a layer a sun and a texel a pixel for the local lights, the projection's view uniforms — when the
 * budget's room holds what they grow by: a larger canvas, more casting lights (`masksGrowth`). The
 * lists the raster then grows within the room cannot take theirs. Past it the lights read no
 * shadow this frame, said once a set, and the next frames ask again. The same while the engine's blue noise is not made
 * (the frames wait for it at their entry: `askBlueNoise`).
 */
export function reserveProjection(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  vsm: EngineVsm,
  list: readonly VsmFrameLight[],
) {
  const [width, height] = sharedMaskSize(rt, ...rt.gpu.allocatedSize)
  const needs = maskNeedsFor(rt, list)
  const growth = masksGrowth(vsm, width, height, needs) + vsmProjectionBytesToMake(vsm.res)
  if (growth <= 0 || growth <= ledgerRoom(device)) {
    ensureMasks(device, vsm, width, height, needs)
    return projectionReady(vsmProjectionReserve(device, vsm.res))
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
