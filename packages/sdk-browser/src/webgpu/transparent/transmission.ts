import { WATER_RANK_SHIFT } from '../water/rank.ts'
import type { TransmissionBackdrop, WebgpuGpuState } from '../pages/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { WATER_BYTES_PER_PIXEL } from './waterBytes.ts'
import { writeVolumeTerms } from '../material/materialRecord.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'

/** The volume's terms as its surface's record holds them (`writeVolumeTerms`: `transmission`, the
 *  refraction ratio 1 / ior, `thickness`, Fresnel's f0, then aligned the law's constant `k`), the
 *  marks word, then the item's rank in the item records (`VOLUME_ITEM`), whose world matrix takes
 *  the declared thickness to the world (`volumeWorldPath`) and whose pose the water rectangle
 *  encloses: one record per transmissive item, read by water rank in a storage buffer — the water
 *  composite's fragment stage holds the sixteen sampled textures WebGPU guarantees, which the
 *  material table would pass. The per-volume terms are computed once, in f64, by the record's own
 *  writer, not per pixel in f32. The record is the WGSL `Volume`, aligned to sixteen bytes. */
export const VOLUME_WORDS = 12
export const VOLUME_ITEM = 8
/** The marks word's bits, a small integer in a float: the surface takes no fog, and it carries an
 *  anisotropic or clear-coat lobe, whose texel the water composite reads
 *  (`../water/waterLobesWgsl.ts`). */
export const VOLUME_FOG_FREE = 1
export const VOLUME_LOBED = 2
/** Whether volume `vol`'s marks word holds `bit`: every read of the word in a composite. */
export const VOLUME_MARKED_WGSL = wgslBlock(
  'VOLUME_MARKED_WGSL',
  [],
  `fn volumeMarked(vol:Volume,bit:u32)->bool{return (u32(vol.attenuation.w)&bit)!=0u;}`,
)

/** Whether the session's targets hold the water pass's: a transmissive item is held, or a source
 *  that brings one was granted the pass (`blendState.waterGranted`). */
export const holdsWater = ({ blendState }: Pick<WebgpuPagesRuntime, 'blendState'>) =>
  blendState.transmissive > 0 || !!blendState.waterGranted

/** What the water pass adds to the image budget, zero with no transmissive surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return holdsWater(rt) ? width * height * WATER_BYTES_PER_PIXEL : 0
}

/**
 * Allocates what the water pass owns: the frozen colour its composite rereads, and the depth its
 * surface stage writes. With no transmissive surface they are one texel: the bind
 * layouts are the same for the whole scene, and nothing is reserved for a class the scene does
 * not carry.
 */
export function createBackdrop(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
): TransmissionBackdrop {
  const size = { width: active ? width : 1, height: active ? height : 1 }
  // The colour is written by the indirect backdrop copy (`../water/copy.ts`), a compute store; the
  // depth by the restore drawn in the surface pass (`../water/depthRestore.ts`). Both are read.
  const color = device.createTexture({
    label: 'Trillion3D backdrop color',
    size,
    format: HDR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  })
  const waterDepth = device.createTexture({
    label: 'Trillion3D water depth',
    size,
    format: DEPTH_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  return {
    color,
    colorView: color.createView(),
    waterDepth,
    waterDepthView: waterDepth.createView(),
    active,
  }
}

export function disposeBackdrop(gpu: WebgpuGpuState) {
  const backdrop = gpu.backdrop
  if (!backdrop) return
  backdrop.color.destroy()
  backdrop.waterDepth.destroy()
  gpu.backdrop = undefined
}

/** Water rank of an item, as its flags carry it: one-based, zero for an item that does not
 *  transmit (`../blend/prepare.ts`). */
export const waterRankOf = (flags: number) => flags >>> WATER_RANK_SHIFT

/** Volume of each transmissive item, at the rank the item carries in its flags: that is the rank
 *  the composite reads through the water surface, with the item's own rank in the item records.
 *  Written with the rows, never per image. */
export function writeVolumeRecords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    packed = blendState.volumePacked
  if (!gpu.volumeBuffer || !blendState.transmissive) return
  const words = new Uint32Array(packed.buffer)
  blendState.blendGpu.forEach((item, index) => {
    const rank = waterRankOf(item.flags)
    if (!rank) return
    const base = (rank - 1) * VOLUME_WORDS,
      mat = item.surface
    writeVolumeTerms(packed, base, mat)
    packed[base + 7] = (mat.fog === false ? VOLUME_FOG_FREE : 0) | (item.lobed ? VOLUME_LOBED : 0)
    words[base + VOLUME_ITEM] = index
  })
  device.queue.writeBuffer(gpu.volumeBuffer, 0, packed)
}

/** The volume table made to hold the transmissive items the session holds now: the records it has
 *  stay at their rank, a table that fills is copied once into one twice as long. */
export function growVolumes(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    held = blendState.volumePacked
  const words = blendState.transmissive * VOLUME_WORDS
  if (words <= held.length) return
  const packed = new Float32Array(Math.max(words, 2 * held.length))
  packed.set(held)
  blendState.volumePacked = packed
  const outgrown = gpu.volumeBuffer
  gpu.volumeBuffer = createVolumeBuffer(device, packed.length / VOLUME_WORDS)
  outgrown?.destroy()
}

/** Volume buffer, sized to the scene's transmissive-item count. */
export function createVolumeBuffer(device: GPUDevice, transmissive: number) {
  return device.createBuffer({
    label: 'Trillion3D transmissive volumes',
    size: Math.max(1, transmissive) * VOLUME_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}
