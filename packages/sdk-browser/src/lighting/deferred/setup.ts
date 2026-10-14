import { receiverPlaceholders } from '../../webgpu/visibility/receiver.ts'
import { deferredLayoutEntries } from './layoutEntries.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { PROBE_TEXELS, emptyAtlas } from '../../bounce/atlas.ts'
import { BOUNCE_GRID_BYTES } from '../../bounce/uniform.ts'
import { runtimeStandIns } from '../../bounce/runtimeStandIns.ts'
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from '../../vsm/constants.ts'
import { VSM_PROJECTION_MASK_FORMAT, VSM_PROJECTION_TILE_FORMAT } from '../../vsm/projectionWgsl.ts'
import { VSM_TRANSMISSION_FORMAT } from '../../vsm/transmissionLayout.ts'
import { VSM_PROJECTION_VIEW_BYTES } from '../../vsm/projectionView.ts'
import { REFLECTION_FORMAT } from '../../reflections/constants.ts'

/** The resolve's layout; each composition's is its own (`compositions.ts`). */
export const createDeferredLightingLayout = (device: GPUDevice, direct: boolean, bounce = false) =>
  device.createBindGroupLayout({ entries: deferredLayoutEntries(direct, bounce) })

/**
 * Contract substitute resources: an empty tile list, a one-texel transmittance layer, a probe
 * grid at zero, and the virtual shadow maps' stand-ins. A device without
 * the maps keeps valid bindings, the light simply unshadowed; a frame without bounce reads zero
 * probes, hence zero indirect light. The blend pass borrows the same substitutes.
 */
export type DeferredPlaceholders = ReturnType<typeof createDeferredPlaceholders>
export function createDeferredPlaceholders(device: GPUDevice) {
  const tiles = device.createBuffer({
    label: 'Trillion3D empty light tiles',
    size: 256,
    usage: GPUBufferUsage.STORAGE,
  })
  // One texel: the shadow read tells it from a real layer by its size, and never reads it.
  const transmittance = standInTexture(
    device,
    'Trillion3D empty shadow transmittance',
    VSM_TRANSMISSION_FORMAT,
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
  const probes = emptyAtlas(device, 'Trillion3D empty bounce probes', PROBE_TEXELS)
  // The proxy's bindings in every program that traces it when no placement wears one.
  const standIns = runtimeStandIns(device)
  const receiver = receiverPlaceholders(device)
  const vsm = createVsmPlaceholders(device)
  // One texel of zero: what a resolve bound before its reflection target reads.
  const reflection = device.createTexture({
    label: 'Trillion3D empty reflection',
    size: [1, 1],
    format: REFLECTION_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  return {
    ...vsm.views,
    tiles,
    transmittanceView: arrayView(transmittance),
    bounceGrid,
    probes: arrayView(probes),
    runtime: standIns.runtime,
    runtimeWorlds: standIns.runtimeWorlds,
    runtimeTree: standIns.runtimeTree,
    runtimeStore: standIns.runtimeStore,
    receiver: receiver.resources,
    reflection: reflection.createView(),
    /** The empty normal atlas: what a transparent item without normals reads (zeros). */
    emptyNormals: receiver.normals,
    dispose() {
      receiver.dispose()
      reflection.destroy()
      vsm.destroy()
      tiles.destroy()
      transmittance.destroy()
      bounceGrid.destroy()
      probes.destroy()
      standIns.destroy()
    },
  }
}

/** The virtual shadow maps' stand-ins: no light reads them (no light has a map without them). The
 *  resolve's mask stand-in, one zero texel (every lane lit), its tile words, one zero texel (no
 *  layer stored); the projection's view and blue noise a
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
  const vsmMaskTiles = standInTexture(
    device,
    'Trillion3D empty VSM mask tiles',
    VSM_PROJECTION_TILE_FORMAT,
  )
  const vsmProjectionView = device.createBuffer({
    label: 'Trillion3D empty VSM projection view',
    size: VSM_PROJECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  })
  const vsmBlueNoise = standInTexture(device, 'Trillion3D empty VSM blue noise', 'rgba8unorm')
  const textures = [vsmMask, vsmMaskTiles, vsmBlueNoise]
  return {
    views: {
      vsmPageTable,
      vsmProjectionData,
      vsmUniforms,
      vsmPool,
      vsmMask: arrayView(vsmMask),
      vsmMaskTiles: vsmMaskTiles.createView(),
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
