import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { ResourceAllocator } from '../../gpu/core/resourceAllocator.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import type { HairNodes } from '../compactionPass.ts'
import type { DrawnInstance } from '../ribbonBinds.ts'
import { FORWARD_BIN_WGSL, FORWARD_DEPTH_GRID_WGSL } from './forwardBinWgsl.ts'
import { FORWARD_CLEAR_WGSL } from './forwardClearWgsl.ts'
import { FORWARD_PARAM_WORDS } from './forwardCommonWgsl.ts'
import { FORWARD_CULL_WGSL } from './forwardCullWgsl.ts'
import { FORWARD_GATHER_WGSL } from './forwardGatherWgsl.ts'
import {
  FORWARD_THREADS,
  FORWARD_COUNTER,
  FORWARD_TILE,
  type ForwardLayout,
} from './forwardMath.ts'
import { FORWARD_COLOR_FORMAT, forwardRasterWgsl } from './forwardRasterWgsl.ts'

const label = (name: string) => `${HAIR_STRANDS_PASS_PREFIX}forward ${name}`
const kernels = {
  cull: autoKernel(label('cull'), FORWARD_CULL_WGSL, 'forwardCull'),
  depthGrid: autoKernel(label('depth grid'), FORWARD_DEPTH_GRID_WGSL, 'forwardDepthGrid'),
  bin: autoKernel(label('binning'), FORWARD_BIN_WGSL, 'forwardBin'),
  gather: autoKernel(label('gather'), FORWARD_GATHER_WGSL, 'forwardGather'),
  depth: autoKernel(label('depth raster'), forwardRasterWgsl(false), 'forwardRaster'),
  color: autoKernel(label('colour raster'), forwardRasterWgsl(true), 'forwardRaster'),
  clear: autoKernel(label('clear'), FORWARD_CLEAR_WGSL, 'forwardClear'),
}

/** The pipelines of the forward raster on `device`, none while one compiles. */
export function forwardPipelines(device: GPUDevice) {
  const made = {
    cull: kernels.cull(device).get(),
    depthGrid: kernels.depthGrid(device).get(),
    bin: kernels.bin(device).get(),
    gather: kernels.gather(device).get(),
    depth: kernels.depth(device).get(),
    color: kernels.color(device).get(),
    clear: kernels.clear(device).get(),
  }
  return Object.values(made).every(Boolean)
    ? (made as { [K in keyof typeof made]: GPUComputePipeline })
    : undefined
}
export type ForwardPipelines = NonNullable<ReturnType<typeof forwardPipelines>>

/** The buffers and textures of the forward raster for `layout`, `capacity` control points and an image of `size`. */
export const allocateForward = (
  allocator: ResourceAllocator,
  layout: ForwardLayout,
  capacity: number,
  size: readonly [number, number],
) => ({
  params: allocator.buffer('parameters', FORWARD_PARAM_WORDS, 'uniform'),
  points: allocator.buffer('control points', capacity * 4, 'storage'),
  grid: allocator.buffer('binners grid', layout.gridWords, 'storage'),
  prims: allocator.buffer('binned segments', layout.primWords, 'storage'),
  primDepths: allocator.buffer('binned depths', layout.primWords, 'storage'),
  tiles: allocator.buffer('binned lists', layout.maxTiles * FORWARD_TILE.words, 'storage'),
  gatheredPrims: allocator.buffer('gathered segments', layout.primWords, 'storage'),
  gatheredTiles: allocator.buffer(
    'gathered lists',
    layout.maxTiles * FORWARD_TILE.words,
    'storage',
  ),
  work: allocator.buffer('tiles to shade', layout.binRes[0] * layout.binRes[1] * 2, 'storage'),
  counters: allocator.buffer('counters', FORWARD_COUNTER.words, 'storage'),
  color: allocator.texture('colour', size, FORWARD_COLOR_FORMAT),
})

const buf = (buffer: GPUBuffer): GPUBindingResource => ({ buffer })

/** Whether two records of sources name the same resources. */
const sameSources = (a: Sources, b: Sources) =>
  a.view === b.view &&
  a.sceneDepth === b.sceneDepth &&
  a.nodes === b.nodes &&
  a.transmittance === b.transmittance &&
  a.hairDepth === b.hairDepth &&
  a.coverage === b.coverage &&
  a.light === b.light

/** A bind group of group `at` of a pipeline, made from the entries `entries` names, kept while the pipeline and the resources it names stay. */
const grouped = (
  entries: (f: ForwardResources, s: Sources, extra: GPUBuffer) => GPUBindingResource[],
  at = 0,
) => {
  let held:
    | {
        pipeline: GPUComputePipeline
        f: ForwardResources
        s: Sources
        extra: GPUBuffer
        group: GPUBindGroup
      }
    | undefined
  return (
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    f: ForwardResources,
    s: Sources,
    extra: GPUBuffer,
  ) => {
    if (
      !held ||
      held.pipeline !== pipeline ||
      held.f !== f ||
      held.extra !== extra ||
      !sameSources(held.s, s)
    )
      held = {
        pipeline,
        f,
        s: { ...s },
        extra,
        group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(at),
          entries: sequentialEntries(entries(f, s, extra)),
        }),
      }
    return held.group
  }
}

/** The bind groups of the forward raster; the cull's is one for each group of curves it reads. */
function forwardBinds() {
  return {
    cull: new Map<GPUBuffer, ReturnType<typeof grouped>>(),
    depthGrid: grouped((f, s) => [buf(f.params), s.sceneDepth, buf(f.grid)]),
    bin: grouped((f, s) => [
      buf(f.params),
      buf(s.view),
      buf(f.points),
      buf(s.nodes.nodeCounter),
      buf(f.grid),
      buf(f.prims),
      buf(f.primDepths),
      buf(f.tiles),
      buf(f.counters),
    ]),
    gather: grouped((f) => [
      buf(f.params),
      buf(f.tiles),
      buf(f.prims),
      buf(f.primDepths),
      buf(f.gatheredTiles),
      buf(f.gatheredPrims),
      buf(f.work),
      buf(f.counters),
    ]),
    depth: grouped((f, s) => [
      buf(f.params),
      buf(s.view),
      buf(f.points),
      buf(f.gatheredPrims),
      buf(f.gatheredTiles),
      buf(f.work),
      buf(f.counters),
      s.sceneDepth,
      s.transmittance!,
      s.hairDepth!,
      s.coverage!,
    ]),
    color: grouped((f, s) => [
      buf(f.params),
      buf(s.view),
      buf(f.points),
      buf(f.gatheredPrims),
      buf(f.gatheredTiles),
      buf(f.work),
      buf(f.counters),
      s.sceneDepth,
      s.light!,
      buf(s.nodes.nodeCounter),
      f.color,
    ]),
    clear: grouped((f, s) => [buf(f.params), s.transmittance!, s.hairDepth!, s.coverage!, f.color]),
  }
}

/** What the passes read of the image: the view block, the opaque depth, the compacted samples' buffers, the strands' targets and, for the colour raster, the lit grid. */
export interface Sources {
  readonly view: GPUBuffer
  readonly sceneDepth: GPUTextureView
  readonly nodes: HairNodes
  readonly transmittance?: GPUTextureView
  readonly hairDepth?: GPUTextureView
  readonly coverage?: GPUTextureView
  readonly light?: GPUTextureView
}

/** The forward raster's resources and what it keeps beside them. */
export type ForwardResources = ReturnType<typeof allocateForward> & {
  layout: ForwardLayout
  readonly capacity: number
  readonly binds: ReturnType<typeof forwardBinds>
  readonly paramWords: ReturnType<typeof wordViews>
}

/** The extension of the resources: the layout they were made for, and the words of the parameters. */
export const extendForward =
  (layout: ForwardLayout, capacity: number) =>
  (): Omit<ForwardResources, keyof ReturnType<typeof allocateForward>> => ({
    layout,
    capacity,
    binds: forwardBinds(),
    paramWords: wordViews(new ArrayBuffer(FORWARD_PARAM_WORDS * 4)),
  })

/** Writes the parameters of the image of `size` where they changed. */
export function sendForwardParams(
  device: GPUDevice,
  f: ForwardResources,
  size: readonly [number, number],
  fullCoverage: number,
) {
  const { u, f: floats } = f.paramWords
  const { layout } = f
  u[0] = size[0]
  u[1] = size[1]
  u[2] = layout.binRes[0]
  u[3] = layout.binRes[1]
  u[4] = layout.rasterRes[0]
  u[5] = layout.rasterRes[1]
  u[6] = layout.numBinners
  u[7] = layout.numRasterizers
  u[8] = layout.maxTiles
  u[9] = f.capacity
  floats[10] = fullCoverage
  writeChanged(device, f.params, u, 0, FORWARD_PARAM_WORDS)
}

/** Empties what the passes fill, outside any pass of `encoder`: the binners' grid and the counters. */
export function clearForward(encoder: GPUCommandEncoder, f: ForwardResources) {
  encoder.clearBuffer(f.grid)
  encoder.clearBuffer(f.counters)
}

/** The instance whose curves the cull reads: its group's curves and their count. */
export interface ForwardMember {
  readonly drawn: DrawnInstance
  readonly curves: GPUBuffer
  readonly curveCount: number
}

/**
 * The visibility stage, in `pass`: the image's targets emptied, every control point of the drawn instances made a sample (the cull), the furthest opaque
 * depth of each tile of 32 pixels, the segments binned into the tiles, the lists of a tile gathered and ordered by depth, and the depth raster, which
 * writes the transmittance, the depth of the nearest strand and the coverage of each pixel.
 */
export function encodeForwardVisibility(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  p: ForwardPipelines,
  f: ForwardResources,
  s: Sources,
  members: readonly ForwardMember[],
  size: readonly [number, number],
) {
  const { binds, layout } = f
  pass.setPipeline(p.clear)
  pass.setBindGroup(0, binds.clear(device, p.clear, f, s, f.params))
  pass.dispatchWorkgroups(ceilDiv(size[0], 8), ceilDiv(size[1], 8))
  pass.setPipeline(p.cull)
  for (const { drawn, curves, curveCount } of members) {
    let curveBinds = binds.cull.get(curves)
    if (!curveBinds)
      binds.cull.set(
        curves,
        (curveBinds = grouped(
          (g, a, c) => [
            buf(a.view),
            buf(g.params),
            buf(c),
            buf(a.nodes.nodeVis),
            buf(a.nodes.nodeCoord),
            buf(a.nodes.nodeCounter),
            buf(g.points),
          ],
          1,
        )),
      )
    pass.setBindGroup(0, drawn.group(p.cull))
    pass.setBindGroup(1, curveBinds(device, p.cull, f, s, curves))
    dispatchRows(pass, ceilDiv(curveCount, FORWARD_THREADS))
  }
  pass.setPipeline(p.depthGrid)
  pass.setBindGroup(0, binds.depthGrid(device, p.depthGrid, f, s, f.params))
  pass.dispatchWorkgroups(layout.binRes[0], layout.binRes[1])
  pass.setPipeline(p.bin)
  pass.setBindGroup(0, binds.bin(device, p.bin, f, s, f.params))
  pass.dispatchWorkgroups(layout.numBinners)
  pass.setPipeline(p.gather)
  pass.setBindGroup(0, binds.gather(device, p.gather, f, s, f.params))
  pass.dispatchWorkgroups(layout.binRes[0], layout.binRes[1])
  pass.setPipeline(p.depth)
  pass.setBindGroup(0, binds.depth(device, p.depth, f, s, f.params))
  pass.dispatchWorkgroups(layout.numRasterizers)
}

/** The colour raster, in its own pass of `encoder`: the segments shaded with the lit points' colours (`s.light`), into the colour texture the composition lays on the image. */
export function encodeForwardColor(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  p: ForwardPipelines,
  f: ForwardResources,
  s: Sources,
) {
  const pass = encoder.beginComputePass({ label: label('colour raster') })
  pass.setPipeline(p.color)
  pass.setBindGroup(0, f.binds.color(device, p.color, f, s, f.params))
  pass.dispatchWorkgroups(f.layout.numRasterizers)
  pass.end()
}
