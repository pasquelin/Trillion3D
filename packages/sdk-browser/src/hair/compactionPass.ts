import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { compactWgsl, NODE_ARGS_WGSL } from './compactionWgsl.ts'
import type { HairBandBuffers } from './rasterPass.ts'
import { boundGroups } from './ribbonBinds.ts'
import type { HairTiles } from './tilesPass.ts'
import {
  HAIR_ALL_TILES_DISPATCH,
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_NODE_COUNTERS,
  HAIR_NODE_DATA_WORDS,
  HAIR_SAMPLE_BYTES,
  type HairSampleCount,
} from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The bytes of a compacted sample's pixel: its x on the low `HAIR_COORD_BITS` bits, its y above. */
const NODE_COORD_BYTES = 4

const compactKernels = preparedPipelines(
  ({ samples, wide }: { samples: HairSampleCount; wide: boolean }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}compaction ${samples} ${wide ? 'wide' : 'split'}`,
      compactWgsl(samples, wide),
      'hairCompact',
    ),
  ({ samples, wide }) => `${samples} ${wide}`,
)
const argsKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}node arguments`,
  NODE_ARGS_WGSL,
  'hairNodeArgs',
)

/** The pipelines of the compaction on `device`, none while one compiles. */
export function compactionPipelines(device: GPUDevice, samples: HairSampleCount, wide: boolean) {
  const compact = compactKernels.of({ samples, wide })(device).get()
  const args = argsKernel(device).get()
  return compact && args ? { compact, args } : undefined
}

/** What the compaction of every band of an image reads, and writes, beside the opaque depth: the image
 *  block, the transmittance, the lists of tiles, and the textures of the descriptors and the coverage
 *  (the coverage texture's existence is what makes the view's strands valid). */
export interface HairCompactionFrame {
  readonly image: GPUBuffer
  readonly transmittance: GPUTextureView
  readonly tiles: HairTiles
  readonly nodeIndex: GPUTextureView
  readonly coverage: GPUTextureView
}

/** The bind group of the compaction over one band, kept while the resources it names stay: the image's
 *  (`frame`, made again with the sets it names, and the opaque depth), the band's and the samples'. */
export const compactionBinds = () =>
  boundGroups<HairCompactionFrame, HairBandBuffers, HairNodes, GPUTextureView>(
    1,
    (device, pipeline, frame, band, nodes, depthView) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: sequentialEntries([
          { buffer: frame.image },
          depthView,
          frame.transmittance,
          { buffer: band.samples },
          { buffer: frame.tiles.counts },
          { buffer: frame.tiles.data },
          { buffer: nodes.nodeCounter },
          frame.nodeIndex,
          frame.coverage,
          { buffer: nodes.nodeVis },
          { buffer: nodes.nodeCoord },
          { buffer: band.window },
        ]),
      }),
  )

/**
 * The compacted samples of a view: `nodeVis` (the depth on the high 24 bits of the first word and the
 * share of the pixel's samples on the low eight, the identifier in the second), `nodeCoord` and
 * `nodeData` (the material, `HAIR_NODE_DATA_WORDS` words, written by the material pass) for each
 * sample, the counters of the samples (`HAIR_NODE_COUNTER_*`: those placed in all, those stored), and
 * the dispatch over the stored ones (`nodeArgs`). `capacity` is the room for samples.
 */
export interface HairNodes {
  readonly capacity: number
  readonly nodeVis: GPUBuffer
  readonly nodeCoord: GPUBuffer
  readonly nodeData: GPUBuffer
  readonly nodeCounter: GPUBuffer
  readonly nodeArgs: GPUBuffer
  readonly argsGroup: ReturnType<typeof argsBinds>
}

/** The bind group of the dispatch over the stored samples. */
const argsBinds = () =>
  boundGroups<HairNodes, undefined, undefined>(1, (device, pipeline, nodes) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bufferEntries([nodes.nodeCounter, nodes.nodeArgs]),
    }),
  )

/** The buffers of compacted samples with room for `capacity`, named to `allocator`; `readback` is the
 *  usage a proof that reads them back adds (`HairViewGpu.readback`). */
export const allocateHairNodes = (
  allocator: ResourceAllocator,
  capacity: number,
  readback: GPUBufferUsageFlags,
) => ({
  nodeVis: allocator.buffer(
    'node visibility',
    capacity * (HAIR_SAMPLE_BYTES / 4),
    'storage',
    readback,
  ),
  nodeCoord: allocator.buffer('node pixel', capacity * (NODE_COORD_BYTES / 4), 'storage', readback),
  nodeData: allocator.buffer('node material', capacity * HAIR_NODE_DATA_WORDS, 'storage', readback),
  nodeCounter: allocator.buffer('node counters', HAIR_NODE_COUNTERS, 'storage', readback),
  nodeArgs: allocator.buffer('node arguments', HAIR_DISPATCH_ARGS_WORDS, 'args', readback),
})

/** The compacted samples over `buffers`, made as `allocateHairNodes(_, capacity)` describes. */
export const hairNodes = (
  capacity: number,
  buffers: Pick<HairNodes, 'nodeVis' | 'nodeCoord' | 'nodeData' | 'nodeCounter' | 'nodeArgs'>,
): HairNodes => ({ capacity, ...buffers, argsGroup: argsBinds() })

/** Empties the counters of `nodes`, outside any pass of `encoder`: none was placed. */
export const clearHairNodes = (encoder: GPUCommandEncoder, nodes: HairNodes) =>
  encoder.clearBuffer(nodes.nodeCounter)

/** Compacts the samples of the tiles with any strand that lie in one band, in `pass`; `group` is the
 *  band's bind group (`compactionBinds`). */
export function encodeHairCompaction(
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof compactionPipelines>>,
  group: GPUBindGroup,
  tiles: HairTiles,
) {
  pass.setPipeline(pipelines.compact)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}

/** Writes the dispatch over the stored samples, once every band is compacted, in `pass`. */
export function encodeHairNodeArgs(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof compactionPipelines>>,
  nodes: HairNodes,
) {
  pass.setPipeline(pipelines.args)
  pass.setBindGroup(0, nodes.argsGroup(device, pipelines.args, nodes))
  pass.dispatchWorkgroups(1)
}
