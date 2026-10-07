import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/index.ts'
import { createGpuLightTiles } from '../../../lighting/tiles/tiles.ts'
import { shadowPageLayout } from '../../shadow/pageGroup.ts'
import { grantCapability } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { isCancelled } from '../../../engine/common.ts'
import { prepareVsmPipelines } from '../render/vsm/vsmPlan.ts'

/** What the capability declares when the direct-lighting contract is not fitted on this device. */
const DIRECT_LIGHT_CAPABILITY = 'contract scene lights with shadow atlas'

/**
 * Fits the direct-lighting contract: per-tile light lists and the shadow raster's page rows group
 * layout (`../../shadow/pageGroup.ts`); the virtual shadow maps (`../render/vsm/`) make the rest at
 * the first lit frame. Both are optional — a device without compute, or that refuses the layout,
 * keeps a correct image, the contract lights stay off and the missing capability is declared.
 * Nothing is dropped in silence.
 */
export async function prepareDirectLights(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, vis, capabilities, diag } = rt
  if (!lights.buffer || !vis.visBindGroupLayout) {
    lights.shadowReason = 'visibility buffer unavailable'
    return
  }
  try {
    lights.tiles = await createGpuLightTiles(device)
  } catch (error) {
    if (isCancelled(rt.signal)) throw error
    lights.shadowReason = `light tiles unavailable: ${String(error)}`
    diag.diagnosticFailure('light-tiles-unavailable', error)
    return
  }
  try {
    lights.pageLayout = shadowPageLayout(device)
  } catch (error) {
    if (isCancelled(rt.signal)) throw error
    lights.shadowReason = `shadow raster unavailable: ${String(error)}`
    diag.diagnosticFailure('shadow-raster-unavailable', error)
  }
  if (lights.tiles && lights.pageLayout) grantCapability(capabilities, DIRECT_LIGHT_CAPABILITY)
  diag.engineDiagnostic('direct-lighting', 'Direct lighting of the contract, fitted', {
    version: 1,
    settings: { ...LIGHT_SETTINGS },
    tileLists: !!lights.tiles,
    shadowRaster: !!lights.pageLayout,
    unavailable: lights.shadowReason,
  })
}

/**
 * The shadow step's cold work, said apart from every frame: the shadow maps' pipelines for
 * the set its casting lights are first granted (`prepareVsmPipelines`), compiled now for a scene
 * with shadows. One that fails here is compiled again, and said, where it is first used.
 */
export async function prepareShadowPipelines(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.lights.pageLayout) return
  let shadowMaps: Promise<void>[] = []
  try {
    shadowMaps = prepareVsmPipelines(rt, device)
  } catch {
    // A device without compute pipelines makes none; the frame says it where it needs one.
  }
  await Promise.allSettled(shadowMaps)
}
