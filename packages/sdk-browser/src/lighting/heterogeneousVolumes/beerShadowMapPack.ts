import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputePipeline } from '../deferred/fullscreen.ts'
import { HV_SHADOW_BYTES, type HeterogeneousShadowMap } from './beerShadowMapGpu.ts'
import { PACK_WGSL } from './beerShadowMapPackWgsl.ts'

/** The words a block of a map takes, the header of the shadow struct included. */
const blockWords = (map: HeterogeneousShadowMap, precision: number) =>
  HV_SHADOW_BYTES / 4 + map.resolution * map.resolution * map.faces * (precision ? 4 : 2)

export interface PackResources {
  readonly layout: GPUBindGroupLayout
  readonly pipeline: ReturnType<typeof preparedComputePipeline>
}

/** The pack pass's pipeline, compiled off the thread at the first ask (`preparedComputePipeline`): the frames wait for it. */
export function packResourcesOf(device: GPUDevice): PackResources {
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'unfilterable-float'),
      computeBufferEntry(1, 'storage'),
      computeUniformEntry(2),
    ],
  })
  const label = 'Trillion3D heterogeneous volume shadow maps pack'
  const pipeline = preparedComputePipeline(device, {
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ label, code: PACK_WGSL }),
      entryPoint: 'packBeerMap',
    },
  })
  return { layout, pipeline }
}

/**
 * Packs `maps` into `packed` (made by `bufferOf`, as large as `packedWordsOf` says): the header written now, each light's struct
 * copied from its uniform, its texels packed by a dispatch. `jobOf` gives the uniform of a job's four words.
 */
export function encodePack(c: {
  device: GPUDevice
  encoder: GPUCommandEncoder
  resources: PackResources
  packed: GPUBuffer
  maps: readonly HeterogeneousShadowMap[]
  precision: number
  jobOf(rank: number): GPUBuffer
}) {
  const { device, encoder, packed, maps, precision } = c
  const pipeline = c.resources.pipeline.get()
  if (!pipeline) return
  const ranks = Math.max(...maps.map((m) => m.slice)) + 1
  const header = new Uint32Array(1 + ranks)
  header[0] = ranks
  let at = 1 + ranks
  const placed = maps.map((map) => {
    header[1 + map.slice] = at
    const block = at
    at += blockWords(map, precision)
    return { map, block }
  })
  device.queue.writeBuffer(packed, 0, header)
  for (const { map, block } of placed) {
    encoder.copyBufferToBuffer(map.uniform, 0, packed, block * 4, HV_SHADOW_BYTES)
    const job = c.jobOf(map.rank)
    device.queue.writeBuffer(
      job,
      0,
      new Uint32Array([block + HV_SHADOW_BYTES / 4, map.resolution, map.faces, precision]),
    )
    const pass = encoder.beginComputePass({
      label: 'Trillion3D heterogeneous volume shadow map pack',
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: c.resources.layout,
        entries: [
          { binding: 0, resource: map.view },
          { binding: 1, resource: { buffer: packed } },
          { binding: 2, resource: { buffer: job } },
        ],
      }),
    )
    pass.dispatchWorkgroups(
      Math.ceil((map.resolution * map.faces) / 8),
      Math.ceil(map.resolution / 8),
    )
    pass.end()
  }
}

/** The words the packed buffer of `maps` takes: the header and the blocks. */
export const packedWordsOf = (maps: readonly HeterogeneousShadowMap[], precision: number) =>
  1 +
  Math.max(...maps.map((m) => m.slice)) +
  1 +
  maps.reduce((sum, m) => sum + blockWords(m, precision), 0)
