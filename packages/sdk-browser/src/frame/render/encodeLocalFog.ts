import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import {
  localFogLimits,
  type LocalFogLimits,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { localCullOf } from '../../lighting/fog/localCull.ts'
import type { LocalFogPlanSettings } from '../../lighting/fog/localPlan.ts'
import { localSkyOf } from '../../lighting/fog/localSky.ts'
import { localFogTiling } from '../../lighting/fog/localTiling.ts'
import { opaquePyramidOf } from '../../lighting/reflections/frame.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { fogSettingsOf } from './fogSettings.ts'
import { localFogGpuOf, releaseLocalFogTiles, useLocalFogTiles } from './localFogGpu.ts'
import { publishLocalFog } from './localFogView.ts'
import { skyLightReadOf } from './skyLightState.ts'

/** The settings the plan is made under, rewritten in place each image. */
const planned: LocalFogPlanSettings & LocalFogLimits = {
  inVolume: true,
  onTranslucent: false,
  startDistance: 0,
  maxVolumeDensity: 0,
  maxCount: 0,
  tileSize: 0,
}

/**
 * THE LOCAL FOG VOLUMES OF THIS IMAGE, made ready before anything binds the fog's resources: the
 * volumes of the view written into the light buffer (`publishLocalFog`) and, once the culling pass is
 * compiled, the buffer of the lists of the volumes over each tile of the view, made for the tile grid
 * and held only while the view draws a volume (`useLocalFogTiles`). After the lights are pushed, before the
 * transparents' groups are bound. The tile side is the run's, never changed; a grid whose lists would
 * not fit a storage buffer of the device is not tiled, and said: the programs then walk every volume of
 * the view. A scene with none, drawn by the view in no image before, reads no setting; a session whose project
 * switch `localFogVolumeSupport` is off (`WebgpuPagesSetup.localFog`) makes nothing.
 */
export function prepareLocalFog(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const buffer = rt.lights.buffer
  const volumes = rt.context.sceneLocalFog
  if (!rt.setup.localFog || !buffer || (!volumes?.count && !rt.gpu.localFog?.plan.count)) return
  const plan = localFogGpuOf(rt.gpu).plan
  plan.active = false
  plan.count = 0
  const settings = fogSettingsOf(rt)
  if (!volumes?.count || !settings.localFogVolumes || !settings.fogEnabled || !litImageShown(rt)) {
    publishLocalFog(rt, device, buffer, cam)
    return void releaseLocalFogTiles(rt.gpu)
  }
  localFogLimits(settings, planned)
  planned.inVolume = settings.localFogVolumeInVolume
  planned.onTranslucent = settings.localFogVolumeOnTranslucent
  const [width, height] = rt.gpu.targetSize
  let tiling = localCullOf(device, rt.diag).ready
    ? localFogTiling(width, height, planned.tileSize, planned.maxCount, plan.tiling)
    : undefined
  if (tiling && tiling.words * 4 > storageBufferCap(device.limits)) {
    sayTooLarge(rt, tiling.words)
    tiling = undefined
  }
  plan.count = publishLocalFog(rt, device, buffer, cam, planned, tiling)
  if (!plan.count || !tiling) return void releaseLocalFogTiles(rt.gpu)
  useLocalFogTiles(device, rt.gpu, tiling.words)
  plan.active = true
  plan.pyramid = settings.localFogVolumeUsesDepthPyramid
}

/**
 * The lists of the volumes over each tile written into their buffer, in the run `steps`: the pass that culls
 * them by the tile's frustum and, where the run asks for it (`localFogVolumeUsesDepthPyramid`) and the
 * image has built its depth pyramid (`opaquePyramidOf`), by what the pyramid hides. After the depth
 * pyramid, before the fog's volume; nothing where `prepareLocalFog` made no lists.
 */
export function encodeLocalFog(rt: WebgpuPagesRuntime, device: GPUDevice, steps: ComputeRun) {
  const { buffer } = rt.lights
  const tiles = rt.gpu.localFog?.tiles
  const plan = rt.gpu.localFog?.plan
  if (!buffer || !tiles || !plan?.active) return
  const hiz = plan.pyramid ? opaquePyramidOf(rt) : undefined
  localCullOf(device, rt.diag).encode(steps, buffer, tiles, plan.tiling, plan.count, hiz)
}

/** Says, once for a size, that the lists of the tiles would not fit a storage binding. */
function sayTooLarge(rt: WebgpuPagesRuntime, words: number) {
  const held = localFogGpuOf(rt.gpu)
  if (held.saidTooLarge === words) return
  held.saidTooLarge = words
  rt.diag.diagnosticFailure(
    'fog-local-tiles-too-large',
    new Error(
      `the lists of the local fog volumes over ${words} words of tiles do not fit a storage binding: not tiled; raise localFogVolumeTileSize`,
    ),
  )
}

/**
 * The sky light's term written into the local fog volumes' block (`localSky.ts`), in the run `steps`, after the
 * sky light's capture of this image and before the passes that read the volumes: none where the view
 * draws no volume.
 */
export function encodeLocalFogSky(rt: WebgpuPagesRuntime, device: GPUDevice, steps: ComputeRun) {
  const buffer = rt.lights.buffer
  if (!buffer || !rt.gpu.localFog?.plan.count) return
  localSkyOf(device, rt.diag).encode(steps, buffer, skyLightReadOf(rt))
}
