import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { vsmBufferGroup } from '../passKit.ts'
import { vsmBindGroupEntries, type VsmResources } from '../resources.ts'
import {
  createTessellationGroups,
  type TessInput,
} from '../../../../visibility/tessellation/groups.ts'
import {
  DISPATCH_DRAW,
  DISPATCH_SEED,
  DISPATCH_SPLIT,
  MAX_SPLIT_LEVELS,
  PASS_DISPATCH_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { TESS_CHAIN_SHADOW } from '../../../../visibility/tessellation/uniform.ts'
import {
  tessellationSetting,
  tessellationWanted,
} from '../../../../visibility/tessellation/wanted.ts'
import {
  VSM_RENDER_TESSELLATE_DIRECTIONAL,
  VSM_RENDER_TESSELLATE_LOCAL,
} from '../render/renderParamsWgsl.ts'
import type { VsmRenderContext } from '../render/renderPass.ts'
import { vsmRenderContext } from '../render/renderPipes.ts'
import type { Tessellation } from '../../../../visibility/tessellation/tessellation.ts'
import { createShadowPrograms, type ShadowPrograms } from './shadowPrograms.ts'
import { VSM_TESS_PROJECTION_SPECS } from './shadowKernelsWgsl.ts'

/**
 * THE SHADOW MAPS' TESSELLATION OF A FRAME (`VsmShadowTessellation`), as the chunks of casters
 * (`../render/renderChunks.ts`) drive it: a displaced surface's pairs are cut into patches, which
 * are diced and drawn in place of its triangles. It exists while the image tessellates
 * (`tessellationWanted`), a kind of light asks it (`tessellationShadowsDirectional`,
 * `tessellationShadowsLocal`) and every pipeline is compiled; otherwise the surface casts as the flat
 * triangles it is made of, the first frames on included.
 * - `kinds`: the kinds of light whose maps take it (`VSM_RENDER_TESSELLATE_*`);
 * - `begin`, before a chunk's compute pass: the chain's state cleared;
 * - `compute`, in it, once the chunk's pairs are listed: the seeding, the six levels of splitting
 *   and the draw's arguments, over the chunk's lists;
 * - `draw`, in the chunk's raster pass, groups 0 and 1 set: the patches, one indirect draw.
 */
export interface VsmShadowTessellation {
  readonly kinds: number
  begin(encoder: GPUCommandEncoder): void
  compute(pass: GPUComputePassEncoder, lists: ChunkLists, offset: readonly number[]): void
  draw(pass: GPURenderPassEncoder): void
}

/** What a chunk's pairs are read from: its parameters' window, its counters and its pairs. */
export type ChunkLists = {
  params: GPUBufferBinding
  counts: GPUBuffer
  pairs: GPUBuffer
}

/** The groups over a tessellation's buffers, made again with its instance. */
const groupsOf = new WeakMap<object, ReturnType<typeof createTessellationGroups>>()
/** The frame's geometry the groups read, rewritten in place. */
const geometry = {} as TessInput

/** The geometry and atlas the image's raster reads (`visibilityRasterStages`), or none while one is
 *  missing. */
function frameGeometry(rt: WebgpuPagesRuntime) {
  const { vis, gpu } = rt
  const { concatPos, concatUv, concatNrm, pageTable, textures, mapsSampler } = vis
  if (
    !gpu.cache ||
    !concatPos ||
    !concatUv ||
    !concatNrm ||
    !pageTable ||
    !textures ||
    !mapsSampler
  )
    return undefined
  geometry.indices = gpu.cache.buffer
  geometry.positions = concatPos
  geometry.pages = pageTable
  geometry.uvs = concatUv
  geometry.normals = concatNrm
  geometry.textures = textures
  geometry.sampler = mapsSampler
  return geometry
}

/** The kinds of light whose maps take displaced surfaces tessellated, by the two settings. */
function kindsOf(rt: WebgpuPagesRuntime) {
  return (
    (tessellationSetting(rt, 'tessellationShadowsDirectional')
      ? VSM_RENDER_TESSELLATE_DIRECTIONAL
      : 0) | (tessellationSetting(rt, 'tessellationShadowsLocal') ? VSM_RENDER_TESSELLATE_LOCAL : 0)
  )
}

/** The group over the chunk's lists, made again when one of the three buffers moved. */
function listsGroups(device: GPUDevice, programs: ShadowPrograms) {
  const held: { params?: GPUBuffer; counts?: GPUBuffer; pairs?: GPUBuffer; group?: GPUBindGroup } =
    {}
  return ({ params, counts, pairs }: ChunkLists) => {
    if (
      !held.group ||
      held.params !== params.buffer ||
      held.counts !== counts ||
      held.pairs !== pairs
    ) {
      Object.assign(held, { params: params.buffer, counts, pairs })
      held.group = vsmBufferGroup(device, programs.layouts.lists, [params, counts, pairs])
    }
    return held.group
  }
}

/** The group over the maps' projections, made again when the frame set's buffer moved. */
function projectionGroups(device: GPUDevice, programs: ShadowPrograms) {
  const held: { buffer?: GPUBuffer; group?: GPUBindGroup } = {}
  return (res: VsmResources) => {
    if (!held.group || held.buffer !== res.current.projectionData) {
      held.buffer = res.current.projectionData
      held.group = device.createBindGroup({
        layout: programs.layouts.projections,
        entries: vsmBindGroupEntries(res, VSM_TESS_PROJECTION_SPECS),
      })
    }
    return held.group
  }
}

/** What a frame sets of the chain: the instance whose buffers it runs in, the groups over them, the
 *  geometry and the maps' projections, and the kinds of light that take it. */
type ChainFrame = {
  shadow: Tessellation['shadow']
  groups: ReturnType<typeof createTessellationGroups>
  input: TessInput
  projections: GPUBindGroup
  kinds: number
}

/** The seeding over the chunk's pairs, the six levels of splitting and the draw's arguments, in
 *  `pass`, over the chunk's lists group `chunk` at the parameters' `offset`. */
function encodeChain(
  pass: GPUComputePassEncoder,
  programs: ShadowPrograms,
  { shadow, groups, input, projections }: ChainFrame,
  chunk: GPUBindGroup,
  offset: readonly number[],
) {
  const { dispatch } = shadow.resources
  const at = (word: number) => (TESS_CHAIN_SHADOW * PASS_DISPATCH_WORDS + word) * 4
  const planned = groups.of('plan', TESS_CHAIN_SHADOW, input)
  const launch = (stage: { get(): GPUComputePipeline }) => {
    pass.setPipeline(stage.get())
    pass.setBindGroup(0, planned)
    pass.setBindGroup(1, chunk, offset)
    pass.dispatchWorkgroups(1)
  }
  launch(programs.seedArgs)
  pass.setPipeline(programs.seed.get())
  pass.setBindGroup(0, groups.of('shadowSeed', TESS_CHAIN_SHADOW, input))
  pass.setBindGroup(1, chunk, offset)
  pass.dispatchWorkgroupsIndirect(dispatch, at(DISPATCH_SEED))
  const split = groups.of('shadowSplit', TESS_CHAIN_SHADOW, input)
  for (let level = 0; level < MAX_SPLIT_LEVELS; level++) {
    pass.setPipeline(programs.plan.get())
    pass.setBindGroup(0, planned)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(programs.split.get())
    pass.setBindGroup(0, split)
    pass.setBindGroup(1, chunk, offset)
    pass.setBindGroup(2, projections)
    pass.dispatchWorkgroupsIndirect(dispatch, at(DISPATCH_SPLIT))
  }
  launch(programs.drawArgs)
}

/** The chain of a raster context: its pipelines, made the first time a frame asks, the groups it
 *  binds, kept while what they name stands, and what the frame set (`bind`). */
function createShadowChain(ctx: VsmRenderContext) {
  const programs = createShadowPrograms(ctx.device, ctx.layout, ctx.pageLayout, ctx.raster.layout1)
  const listsGroup = listsGroups(ctx.device, programs),
    projectionGroup = projectionGroups(ctx.device, programs)
  let frame: ChainFrame
  const chain: VsmShadowTessellation & {
    programs: ShadowPrograms
    bind(shadow: Tessellation['shadow'], input: TessInput, res: VsmResources, kinds: number): void
  } = {
    get kinds() {
      return frame.kinds
    },
    programs,
    bind(shadow, input, res, kinds) {
      let groups = groupsOf.get(shadow.resources)
      if (!groups)
        groupsOf.set(
          shadow.resources,
          (groups = createTessellationGroups(ctx.device, programs.layouts, {
            resources: shadow.resources,
          })),
        )
      frame = { shadow, groups, input, projections: projectionGroup(res), kinds }
    },
    begin: (encoder) => frame.shadow.clear(encoder),
    compute: (pass, lists, offset) => encodeChain(pass, programs, frame, listsGroup(lists), offset),
    draw(pass) {
      const { shadow, groups, input } = frame
      const at = (TESS_CHAIN_SHADOW * PASS_DISPATCH_WORDS + DISPATCH_DRAW) * 4
      pass.setPipeline(programs.raster.get())
      pass.setBindGroup(2, groups.of('shadowRaster', TESS_CHAIN_SHADOW, input))
      pass.drawIndirect(shadow.resources.dispatch, at)
    },
  }
  return chain
}

/** The chain of each raster context. */
const chains = new WeakMap<VsmRenderContext, ReturnType<typeof createShadowChain>>()

/**
 * The shadow maps' tessellation of this frame over the maps of `vsm` (see `VsmShadowTessellation`),
 * none where nothing asks it. While its pipelines compile the casters draw the flat triangles they
 * are made of, and the frame is not drawn as far as the cache is concerned (`vsm.renderedPlan`
 * cleared): its pages are not kept as cached, the next image draws them again.
 */
export function vsmShadowTessellation(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  vsm: { res: VsmResources; renderedPlan: unknown },
  pageLayout: GPUBindGroupLayout,
): VsmShadowTessellation | undefined {
  const kinds = tessellationWanted(rt) ? kindsOf(rt) : 0
  const tessellation = rt.vis.gpuRaster?.tessellation
  const input = kinds && tessellation ? frameGeometry(rt) : undefined
  if (!kinds || !tessellation || !input) return undefined
  const ctx = vsmRenderContext(vsm.res, device, pageLayout)
  let chain = chains.get(ctx)
  if (!chain) chains.set(ctx, (chain = createShadowChain(ctx)))
  if (!chain.programs.ask()) {
    vsm.renderedPlan = undefined
    return undefined
  }
  const { shadow } = tessellation
  shadow.prepare(
    rt.vis.materialTable.displaced,
    {
      tessellationDicingRate: tessellationSetting(rt, 'tessellationDicingRate'),
      tessellationMaxPatchesPerGroup: tessellationSetting(rt, 'tessellationMaxPatchesPerGroup'),
    },
    rt.run.selectionUniforms.pixelError,
  )
  chain.bind(shadow, input, vsm.res, kinds)
  return chain
}
