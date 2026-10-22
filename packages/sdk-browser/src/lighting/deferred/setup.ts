import { createFloatAtlas } from '../../gpu/core/floatAtlas.ts'
import { deferredLayoutEntries } from './layoutEntries.ts'
import { LIGHT_SHAFT_NO_MASK } from '../../modules/sky/lightShafts/layout.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { BOUNCE_ATLAS_FORMAT, PROBE_TEXELS } from '../bounce/atlas.ts'
import { BOUNCE_GRID_BYTES } from '../bounce/uniform.ts'
import { runtimeStandIns } from '../bounce/runtime/runtimeStandIns.ts'
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from '../shadows/vsm/constants.ts'
import {
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_THROUGH_FORMAT,
  VSM_PROJECTION_TILE_FORMAT,
} from '../shadows/vsm/projection/projectionWgsl.ts'
import { VSM_TRANSMISSION_FORMAT } from '../shadows/vsm/transmission/transmissionLayout.ts'
import { VSM_PROJECTION_VIEW_BYTES } from '../shadows/vsm/projection/projectionView.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { SCREEN_PROBE_FORMATS } from '../bounce/screen/screenProbeLayout.ts'
import { AO_OCCLUSION_FORMAT } from '../ao/layout.ts'
import { createFogStandIns } from '../fog/read.ts'
import { createLightFunctionStandIns } from '../lightFunction/standIns.ts'
import { BLUE_NOISE_FORMAT } from '../../gpu/noise/blueNoiseTextures.ts'

/** The resolve's layout; each composition's is its own (`compositions.ts`). */
export const createDeferredLightingLayout = (device: GPUDevice, direct: boolean, bounce = false) =>
  device.createBindGroupLayout({ entries: deferredLayoutEntries(direct, bounce) })

/**
 * Contract substitute resources: an empty tile list, a one-texel transmittance layer, a probe
 * grid at zero, the virtual shadow maps' stand-ins, and what the fog is read through where the scene
 * has no cubemap and the image builds no volume (`createFogStandIns`). A device without
 * the maps keeps valid bindings, the light simply unshadowed; a frame without bounce reads zero
 * probes, hence zero indirect light. The blend pass borrows the same substitutes.
 */
export type DeferredPlaceholders = ReturnType<typeof createDeferredPlaceholders>

/** The empty light tiles, the one-texel transmittance layer, the probe grid at zero and its atlas
 *  (`createDeferredPlaceholders`). */
function createContractStandIns(device: GPUDevice) {
  const tiles = device.createBuffer({
    label: 'Trillion3D empty light tiles',
    size: 256,
    usage: GPUBufferUsage.STORAGE,
  })
  // One texel: the shadow read tells it from a real layer by its size, and never reads it; bound as
  // storage where a blended surface's trace reads the casters' memory by load.
  const transmittance = standInTexture(
    device,
    'Trillion3D empty shadow transmittance',
    VSM_TRANSMISSION_FORMAT,
    { storage: true },
  )
  // The substitute carries the size of `BounceGrid`, read where the struct is written: a binding
  // smaller than what the shader declares is refused by validation, and the device is lost.
  // At zero, the probe count is too and `sampleBounce` returns without reading a coefficient;
  // the probe atlas holds a whole probe, so its size also follows the struct.
  const bounceGrid = device.createBuffer({
    label: 'Trillion3D empty bounce grid',
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  })
  const probes = standInTexture(device, 'Trillion3D empty bounce probes', BOUNCE_ATLAS_FORMAT, {
    side: PROBE_TEXELS,
  })
  return {
    tiles,
    transmittance: arrayView(transmittance),
    bounceGrid,
    probes: arrayView(probes),
    destroy() {
      tiles.destroy()
      transmittance.destroy()
      bounceGrid.destroy()
      probes.destroy()
    },
  }
}

export function createDeferredPlaceholders(device: GPUDevice) {
  const contract = createContractStandIns(device)
  // The fog's, made when a program first asks for them: a scene with no fog makes none.
  let fogStandIns: ReturnType<typeof createFogStandIns> | undefined
  // The proxy's bindings in every program that traces it when no placement wears one.
  const standIns = runtimeStandIns(device)
  const normals = createFloatAtlas(device, 'Trillion3D empty normals', 1)
  const vsm = createVsmPlaceholders(device)
  const lightFunction = createLightFunctionStandIns(device)
  // One texel of zero: what a resolve bound before its reflection target reads.
  const reflection = device.createTexture({
    label: 'Trillion3D empty reflection',
    size: [1, 1],
    format: HDR_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  // One texel of zero, its occlusion too: what a resolve reads of the screen probes where none ran, and
  // reads the world's probes instead (`screenIndirectAt`).
  const screenIndirect = standInTexture(
    device,
    'Trillion3D empty screen indirect',
    SCREEN_PROBE_FORMATS.history,
  )
  // One texel of zero: what a resolve reads of the ambient occlusion where the image drew none, and applies none
  // of (`DeferredLighting.setAmbientOcclusion`).
  const ambientOcclusion = standInTexture(
    device,
    'Trillion3D empty ambient occlusion',
    AO_OCCLUSION_FORMAT,
  )
  // One white texel: the light shafts' mask where the image drew none, which multiplies the fog by 1.
  const lightShaft = standInTexture(
    device,
    'Trillion3D empty light shaft mask',
    LIGHT_SHAFT_NO_MASK.format,
    { fill: LIGHT_SHAFT_NO_MASK.fill },
  )
  return {
    ...vsm.views,
    tiles: contract.tiles,
    get fog() {
      return (fogStandIns ??= createFogStandIns(device)).read
    },
    transmittanceView: contract.transmittance,
    bounceGrid: contract.bounceGrid,
    probes: contract.probes,
    lightFunction: lightFunction.read,
    runtime: standIns.runtime,
    runtimeWorlds: standIns.runtimeWorlds,
    runtimeTree: standIns.runtimeTree,
    reflection: reflection.createView(),
    screenIndirect: screenIndirect.createView(),
    ambientOcclusion: ambientOcclusion.createView(),
    lightShaft: lightShaft.createView(),
    /** The empty normal atlas: what a transparent item without normals reads (zeros). */
    emptyNormals: normals.view,
    dispose() {
      normals.texture.destroy()
      reflection.destroy()
      screenIndirect.destroy()
      ambientOcclusion.destroy()
      lightShaft.destroy()
      fogStandIns?.destroy()
      vsm.destroy()
      lightFunction.destroy()
      contract.destroy()
      standIns.destroy()
    },
  }
}

/** The virtual shadow maps' stand-ins: no light reads them (no light has a map without them). The
 *  resolve's mask stand-in, one zero texel (every lane lit), its tile words, one zero texel (no
 *  layer stored), its transmission, one texel (none read); the projection's view and blue noise a
 *  forward pass traces with (`vsmTraceFactor`): zeros. */
function createVsmPlaceholders(device: GPUDevice) {
  const vsmPageTable = device.createBuffer({
    label: 'Trillion3D empty VSM page table',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const vsmProjectionData = device.createBuffer({
    label: 'Trillion3D empty VSM projection data',
    size: VSM_PROJECTION_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE,
  })
  const vsmUniforms = device.createBuffer({
    label: 'Trillion3D empty VSM uniforms',
    size: VSM_UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  })
  const vsmPool = device.createBuffer({
    label: 'Trillion3D empty VSM pool',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const vsmMask = standInTexture(device, 'Trillion3D empty VSM mask', VSM_PROJECTION_MASK_FORMAT)
  // Read as storage (`MASK_TILES_TARGET`): its usage the load-only targets' own.
  const vsmMaskTiles = device.createTexture({
    label: 'Trillion3D empty VSM mask tiles',
    size: [1, 1, 1],
    format: VSM_PROJECTION_TILE_FORMAT,
    usage: loadOnlyUsage(),
  })
  const vsmProjectionView = device.createBuffer({
    label: 'Trillion3D empty VSM projection view',
    size: VSM_PROJECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  })
  // Bound as storage where a blended surface's trace reads the noise by load.
  const vsmBlueNoise = standInTexture(
    device,
    'Trillion3D empty VSM blue noise',
    BLUE_NOISE_FORMAT,
    { storage: true },
  )
  // One texel: the resolve tells it from a real transmission by its size, and never reads it.
  const vsmThrough = standInTexture(
    device,
    'Trillion3D empty VSM transmission',
    VSM_PROJECTION_THROUGH_FORMAT,
  )
  const textures = [vsmMask, vsmMaskTiles, vsmBlueNoise, vsmThrough]
  return {
    views: {
      vsmPageTable,
      vsmProjectionData,
      vsmUniforms,
      vsmPool,
      vsmMask: arrayView(vsmMask),
      vsmMaskTiles: vsmMaskTiles.createView(),
      vsmThrough: arrayView(vsmThrough),
      vsmProjectionView,
      vsmBlueNoise: vsmBlueNoise.createView(),
    },
    destroy() {
      for (const buffer of [
        vsmPageTable,
        vsmProjectionData,
        vsmUniforms,
        vsmPool,
        vsmProjectionView,
      ])
        buffer.destroy()
      for (const texture of textures) texture.destroy()
    },
  }
}
