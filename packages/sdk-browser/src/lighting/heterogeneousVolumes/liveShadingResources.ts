import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import type { ResolvedHeterogeneousVolume } from '../../../../sdk-core/src/scene/heterogeneousVolume/contracts.ts'
import { fogGraphMaps } from '../../frame/render/fogGraphMaps.ts'
import { createLightingCache, lightingCacheResolution } from './liveShadingGpu.ts'
import { HV_MAX_SPARSE } from './liveShadingProgram.ts'
import { compiledOf, programOf, uploadOf, bufferOf, type State } from './liveShadingState.ts'
import { packedUniforms, type SparseVolumeFrameGpu } from './sparseVolumeGpu.ts'
import type { SparseVolumeEntry, SparseVolumeFrame } from './sparseVolumeFile.ts'
import type { SparseVolumes } from './sparseVolumeLoad.ts'

type SlotGpu =
  | { frame: SparseVolumeFrame; at: number; entry: SparseVolumeEntry; gpu: SparseVolumeFrameGpu }
  | undefined

/** The sparse volumes the graph reads, uploaded: the one the volume names plays its animation (`index`), the others show their first frame. */
function sparseSlotsOf(
  held: State,
  device: GPUDevice,
  sparse: SparseVolumes,
  volume: ResolvedHeterogeneousVolume,
  nodes: readonly number[],
  index: number,
): SlotGpu[] {
  return nodes.map((node, k) => {
    const read = sparse.volumeOfNode(node)
    if (!read) return undefined
    const at = node === volume.source ? index : 0
    const upload = uploadOf(held, device, sparse, `${volume.id}:${k}`, read, at)
    return { frame: sparse.frame(read, at), at, entry: read, gpu: upload.gpu }
  })
}

/** The volume's lighting cache at `size`, made again where the size changed. */
function lightingCacheOf(
  held: State,
  device: GPUDevice,
  id: string,
  size: readonly [number, number, number],
) {
  const key = `${id}:${size.join('x')}`
  let cache = held.caches.get(key)
  if (!cache) {
    for (const [other, old] of held.caches)
      if (other.startsWith(`${id}:`)) (old.destroy(), held.caches.delete(other))
    held.caches.set(key, (cache = createLightingCache(device, size, `${id} cache`)))
  }
  return cache
}

/** The sparse volumes' slots, in a uniform: the scene node each reads and its packed uniforms. */
function slotsBufferOf(
  held: State,
  device: GPUDevice,
  id: string,
  nodes: readonly number[],
  slots: readonly SlotGpu[],
) {
  const words = new Uint32Array(4 + 4 * 2 * HV_MAX_SPARSE).fill(0xffff_ffff)
  slots.forEach((slot, k) => {
    if (!slot) return
    words[k] = nodes[k]
    const atlasTexels = slot.gpu.atlasTiles.map((cells) => cells * 18) as [number, number, number]
    words.set(packedUniforms(slot.frame, slot.at, slot.entry.resolution, atlasTexels), 4 + 8 * k)
  })
  const buffer = bufferOf(
    held,
    device,
    `${id} slots`,
    words.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  device.queue.writeBuffer(buffer, 0, words)
  return buffer
}

/** The resources of a volume for this image: its program, the sparse volumes its graph reads, its lighting cache, the colour atlas
 *  and the buffers of its values and slots; none where something it needs is not there yet. */
export function volumeResourcesOf(c: {
  held: State
  rt: WebgpuPagesRuntime
  device: GPUDevice
  sparse: SparseVolumes
  placed: { volume: ResolvedHeterogeneousVolume; entry: SparseVolumeEntry; index: number }
  settings: (field: HeterogeneousVolumeField) => number
  beerFormat: GPUTextureFormat
  /** Whether the program binds the volumes' holdout (`liveShadingProgram`). */
  holdout: boolean
}) {
  const { held, rt, device, sparse, settings, beerFormat, holdout } = c
  const { volume, entry, index } = c.placed
  const compiled = compiledOf(volume)
  if (!compiled) return undefined
  const program = programOf(held, rt, device, compiled, beerFormat, holdout)
  if (!program.cache || !program.march || !program.beer) return undefined
  const nodes = compiled.slots.sparseNodes(volume.graph!)
  const slotsGpu = sparseSlotsOf(held, device, sparse, volume, nodes, index)
  const cacheSize = lightingCacheResolution(
    entry.resolution,
    settings('heterogeneousVolumesLightingCacheDownsampleFactor'),
    volume.lightingDownsampleFactor,
  )
  const cache = lightingCacheOf(held, device, volume.id, cacheSize)
  // The 2D textures the graph reads come from the colour atlas, asked at their full detail; none is drawn before they are there.
  const maps = compiled.uses.textures ? fogGraphMaps(rt) : undefined
  const atlas = maps?.atlas()
  if (maps) maps.warm(compiled.slots.current(volume.graph!))
  if (maps && !atlas) return undefined
  const values = new ArrayBuffer(Math.max(compiled.slots.bytes, 16))
  if (!compiled.slots.fill(volume.graph!, values, 0, (texture) => maps?.slotOf(texture)))
    return undefined
  const valuesBuffer = bufferOf(
    held,
    device,
    `${volume.id} values`,
    Math.max(compiled.slots.bytes, 16),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )
  device.queue.writeBuffer(valuesBuffer, 0, values)
  const slotsBuffer = slotsBufferOf(held, device, volume.id, nodes, slotsGpu)
  return {
    program,
    cachePipeline: program.cache,
    marchPipeline: program.march,
    aoPipeline: program.ao,
    slotsGpu,
    cacheSize,
    cache,
    atlas,
    valuesBuffer,
    slotsBuffer,
  }
}
