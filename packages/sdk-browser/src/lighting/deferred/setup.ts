import { createFloatAtlas } from '../../gpu/core/floatAtlas.ts'
import { LIGHT_SHAFT_NO_MASK } from '../../modules/sky/lightShafts/layout.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { BOUNCE_ATLAS_FORMAT } from '../bounce/atlas.ts'
import { BOUNCE_GRID_BYTES } from '../bounce/uniform.ts'
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from '../shadows/vsm/constants.ts'
import { VSM_SUN_MASK_FORMAT } from '../shadows/vsm/projection/maskFormat.ts'
import { VSM_PROJECTION_VIEW_BYTES } from '../shadows/vsm/projection/projectionView.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_TARGET_LAYERS } from '../reflections/weight.ts'
import { SCREEN_PROBE_FORMATS } from '../bounce/screen/screenProbeLayout.ts'
import { AO_OCCLUSION_FORMAT } from '../ao/layout.ts'
import { VOLUMETRIC_LIGHT_FORMAT } from './volumetricLightWgsl.ts'
import { createFogStandIns } from '../fog/read.ts'
import { DFSH_NO_MASK_WORDS } from '../distanceField/shadow/layout.ts'
import { DFAO_READ_WORDS } from '../distanceField/ao/readWgsl.ts'
import { createNoFieldRead } from '../distanceField/view.ts'
import { createLightFunctionStandIns } from '../lightFunction/standIns.ts'
import { BLUE_NOISE_FORMAT } from '../../gpu/noise/blueNoiseTextures.ts'

/**
 * Contract substitute resources: an empty tile list, the sun's empty list, a probe
 * grid at zero, the virtual shadow maps' stand-ins, and what the fog is read through where the scene
 * has no cubemap and the image builds no volume (`createFogStandIns`). A device without
 * the maps keeps valid bindings, the light simply unshadowed; a frame without bounce reads zero
 * probes, hence zero indirect light. The blend pass borrows the same substitutes.
 */
export type DeferredPlaceholders = ReturnType<typeof createDeferredPlaceholders>

/** The empty light tiles, the sun's empty list (no directional light), the probe grid at zero and its cell table (`createDeferredPlaceholders`). */
function createContractStandIns(device: GPUDevice) {
  const tiles = standInBuffer(device, 'Trillion3D empty light tiles', 256, GPUBufferUsage.STORAGE)
  // A count of zero: the sun's pass finds no directional light.
  const sunRanks = standInBuffer(device, 'Trillion3D empty sun ranks', 16, GPUBufferUsage.STORAGE)
  // The substitute carries the size of `BounceGrid`, read where the struct is written: a binding
  // smaller than what the shader declares is refused by validation, and the device is lost.
  // At zero, the probe count is too: no program finds a probe in it.
  const bounceGrid = standInBuffer(
    device,
    'Trillion3D empty bounce grid',
    BOUNCE_GRID_BYTES,
    GPUBufferUsage.UNIFORM,
  )
  const probes = standInTexture(device, 'Trillion3D empty bounce cell table', BOUNCE_ATLAS_FORMAT)
  return {
    tiles,
    sunRanks,
    bounceGrid,
    probes: arrayView(probes),
    destroy() {
      tiles.destroy()
      sunRanks.destroy()
      bounceGrid.destroy()
      probes.destroy()
    },
  }
}

/** The sky light's distance-field occlusion where the image drew none: a cell and the uniform that describes it, which
 *  the resolve never reads (its program holds no code for it, or its flag says none applies). */
function createSkyOcclusionStandIns(device: GPUDevice) {
  const dfaoBent = standInBuffer(
    device,
    'Trillion3D empty sky light occlusion',
    16,
    GPUBufferUsage.STORAGE,
  )
  const dfaoRead = standInBuffer(
    device,
    'Trillion3D empty sky light occlusion read',
    DFAO_READ_WORDS * 4,
    GPUBufferUsage.UNIFORM,
  )
  return {
    views: { skyShadowing: { bent: dfaoBent, params: dfaoRead } },
    destroy() {
      dfaoBent.destroy()
      dfaoRead.destroy()
    },
  }
}

/** The one-texel stand-ins of the images a resolve reads where the frame drew none. */
function createImageStandIns(device: GPUDevice) {
  // One texel of zero: what a resolve bound before its reflection target reads.
  const reflection = standInTexture(device, 'Trillion3D empty reflection', HDR_FORMAT, {
    storage: true,
    layers: REFLECTION_TARGET_LAYERS,
  })
  // One texel of zero, its occlusion too: what a resolve reads of the screen probes where none ran, and
  // takes the sky light's irradiance instead (`screenIndirectAt`).
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
  // One texel of zero: the volumetric lightmap's light where the image gathered none, which adds none
  // (`volumetricLightWgsl.ts`).
  const volumetricLight = standInTexture(
    device,
    'Trillion3D empty volumetric lightmap light',
    VOLUMETRIC_LIGHT_FORMAT,
  )
  // One white texel: the light shafts' mask where the image drew none, which multiplies the fog by 1.
  const lightShaft = standInTexture(
    device,
    'Trillion3D empty light shaft mask',
    LIGHT_SHAFT_NO_MASK.format,
    { fill: LIGHT_SHAFT_NO_MASK.fill },
  )
  // One cell of zero: the haze's volume where the image builds none; the view block says so
  // (`VIEW_SLOT.haze`) and the read answers no haze before it samples (`aerialPerspective`).
  const hazeVolume = standInTexture(device, 'Trillion3D empty haze volume', 'rgba16float', {
    dimension: '3d',
  })
  return {
    views: {
      reflection: reflection.createView(),
      screenIndirect: screenIndirect.createView(),
      ambientOcclusion: ambientOcclusion.createView(),
      volumetricLight: volumetricLight.createView(),
      lightShaft: lightShaft.createView(),
      hazeVolume: hazeVolume.createView(),
    },
    destroy() {
      reflection.destroy()
      screenIndirect.destroy()
      ambientOcclusion.destroy()
      volumetricLight.destroy()
      lightShaft.destroy()
      hazeVolume.destroy()
    },
  }
}

export function createDeferredPlaceholders(device: GPUDevice) {
  const contract = createContractStandIns(device)
  // The fog's, made when a program first asks for them: a scene with no fog makes none.
  let fogStandIns: ReturnType<typeof createFogStandIns> | undefined
  const normals = createFloatAtlas(device, 'Trillion3D empty normals', 1)
  const vsm = createVsmPlaceholders(device)
  const skyOcclusion = createSkyOcclusionStandIns(device)
  const lightFunction = createLightFunctionStandIns(device)
  // The global distance field's reads where the scene has none: a view block of no clipmap.
  const distanceField = createNoFieldRead(device)
  const images = createImageStandIns(device)
  return {
    ...vsm.views,
    ...skyOcclusion.views,
    tiles: contract.tiles,
    sunRanks: contract.sunRanks,
    get fog() {
      return (fogStandIns ??= createFogStandIns(device)).read
    },
    bounceGrid: contract.bounceGrid,
    probes: contract.probes,
    lightFunction: lightFunction.read,
    distanceField,
    ...images.views,
    /** The empty normal atlas: what a transparent item without normals reads (zeros). */
    emptyNormals: normals.view,
    dispose() {
      normals.texture.destroy()
      images.destroy()
      fogStandIns?.destroy()
      vsm.destroy()
      skyOcclusion.destroy()
      lightFunction.destroy()
      distanceField.destroy()
      contract.destroy()
    },
  }
}

/** The buffers that stand in for the virtual shadow maps'. */
function vsmStandInBuffers(device: GPUDevice) {
  const vsmPageTable = standInBuffer(
    device,
    'Trillion3D empty VSM page table',
    16,
    GPUBufferUsage.STORAGE,
  )
  const vsmProjectionData = standInBuffer(
    device,
    'Trillion3D empty VSM projection data',
    VSM_PROJECTION_RECORD_BYTES,
    GPUBufferUsage.STORAGE,
  )
  // The shadowed lights' grid, read by no pixel: no light holds a slice without the maps.
  const vsmLightGrid = standInBuffer(
    device,
    'Trillion3D empty VSM light grid',
    4,
    GPUBufferUsage.STORAGE,
  )
  const vsmUniforms = standInBuffer(
    device,
    'Trillion3D empty VSM uniforms',
    VSM_UNIFORMS_BYTES,
    GPUBufferUsage.UNIFORM,
  )
  const vsmPool = standInBuffer(device, 'Trillion3D empty VSM pool', 16, GPUBufferUsage.STORAGE)
  const vsmProjectionView = standInBuffer(
    device,
    'Trillion3D empty VSM projection view',
    VSM_PROJECTION_VIEW_BYTES,
    GPUBufferUsage.UNIFORM,
  )
  // One word: the resolve tells it from a real mask by its length (`vsmFarFactor`, at most
  // `DFSH_NO_MASK_WORDS`), and reads no lane of it — a longer stand-in would read as a mask of zeros,
  // the sun shadowed everywhere.
  const farShadowMask = standInBuffer(
    device,
    'Trillion3D empty sun distance-field shadow',
    DFSH_NO_MASK_WORDS * 4,
    GPUBufferUsage.STORAGE,
  )
  return {
    vsmPageTable,
    vsmProjectionData,
    vsmLightGrid,
    vsmUniforms,
    vsmPool,
    vsmProjectionView,
    farShadowMask,
  }
}

/** The textures that stand in for the virtual shadow maps'. */
function vsmStandInTextures(device: GPUDevice) {
  // The local lights' mask, read by no pixel: no light holds a slice without the maps.
  const vsmMask = standInTexture(device, 'Trillion3D empty VSM mask', 'r32uint')
  // The suns' mask, read as storage (`vsmSunMask`): a share of 1, which lights.
  const vsmSunMask = device.createTexture({
    label: 'Trillion3D empty VSM sun mask',
    size: [1, 1, 1],
    format: VSM_SUN_MASK_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: vsmSunMask },
    new Float32Array([1]),
    { bytesPerRow: 4 },
    [1, 1],
  )
  // Bound as storage where a blended surface's trace reads the noise by load.
  const vsmBlueNoise = standInTexture(
    device,
    'Trillion3D empty VSM blue noise',
    BLUE_NOISE_FORMAT,
    { storage: true },
  )
  return { vsmMask, vsmSunMask, vsmBlueNoise }
}

/** The virtual shadow maps' stand-ins: no light reads them (no light has a map without them). The
 *  resolve's local lights' mask stand-in, one zero texel, and the suns' mask stand-in, one texel of 1
 *  (lit); the projection's view and blue noise a forward pass traces with
 *  (`vsmTraceFactor`): zeros. */
function createVsmPlaceholders(device: GPUDevice) {
  const {
    vsmPageTable,
    vsmProjectionData,
    vsmLightGrid,
    vsmUniforms,
    vsmPool,
    vsmProjectionView,
    farShadowMask,
  } = vsmStandInBuffers(device)
  const { vsmMask, vsmSunMask, vsmBlueNoise } = vsmStandInTextures(device)
  const textures = [vsmMask, vsmSunMask, vsmBlueNoise]
  return {
    views: {
      vsmPageTable,
      vsmProjectionData,
      vsmUniforms,
      vsmPool,
      vsmLightGrid,
      vsmMask: vsmMask.createView(),
      vsmSunMask: vsmSunMask.createView({ dimension: '2d-array' }),
      farShadowMask,
      vsmProjectionView,
      vsmBlueNoise: vsmBlueNoise.createView(),
    },
    destroy() {
      for (const buffer of [
        vsmLightGrid,
        vsmPageTable,
        vsmProjectionData,
        vsmUniforms,
        vsmPool,
        vsmProjectionView,
        farShadowMask,
      ])
        buffer.destroy()
      for (const texture of textures) texture.destroy()
    },
  }
}
