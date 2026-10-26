import type { CloudMaterial } from '../../../../../sdk-core/src/modules/sky/cloudMaterial.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { CLOUD_MATERIAL_FLOATS, packCloudMaterial } from './materialWgsl.ts'
import { CLOUD_SAMPLER, createCloudTextures, type CloudTextures } from './textures.ts'
import { sameWords } from '../../../gpu/core/sameWords.ts'

/**
 * THE CLOUD MATERIAL ON THE GPU, one for a world's clouds part: the material's block, its five
 * generated textures (`createCloudTextures`) and the sampler it reads them through, as the seven
 * bindings of the group that holds them (`cloudMaterialLayoutEntries`, from binding 0: the view
 * tracing, the sky light's capture and the shadow maps bind them at the same place). The textures
 * are generated off the frame, on the device's queue; until they land `entries` is none and no pass
 * that reads the material runs. The block is written again when the material's settings change.
 */
export interface CloudMaterialGpu {
  /** The seven bindings, once the textures are generated; none before. */
  readonly entries: readonly GPUBindGroupEntry[] | undefined
  /** Writes the block of `material` where it differs from the one held. */
  update(material: CloudMaterial): void
  /** Releases the block, the textures and the sampler's place; a generation still in flight lands
   *  released. */
  dispose(): void
}

export function createCloudMaterialGpu(
  device: GPUDevice,
  failed: (error: unknown) => void,
): CloudMaterialGpu {
  const block = device.createBuffer({
    label: 'Trillion3D cloud material',
    size: CLOUD_MATERIAL_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler(CLOUD_SAMPLER)
  const packed = new Float32Array(CLOUD_MATERIAL_FLOATS)
  const held = new Float32Array(CLOUD_MATERIAL_FLOATS)
  let written = false,
    disposed = false,
    textures: CloudTextures | undefined,
    entries: readonly GPUBindGroupEntry[] | undefined
  createCloudTextures(device).then((made) => {
    if (disposed) return made.destroy()
    textures = made
    entries = sequentialEntries([
      { buffer: block },
      made.noise.createView(),
      made.pattern.createView(),
      made.profile.createView(),
      made.mask.createView(),
      made.lightning.createView(),
      sampler,
    ])
  }, failed)
  return {
    get entries() {
      return entries
    },
    update(material) {
      packCloudMaterial(packed, material)
      if (written && sameWords(packed, held)) return
      held.set(packed)
      written = true
      device.queue.writeBuffer(block, 0, packed)
    },
    dispose() {
      disposed = true
      entries = undefined
      textures?.destroy()
      block.destroy()
    },
  }
}
