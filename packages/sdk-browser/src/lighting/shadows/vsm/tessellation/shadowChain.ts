import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { vsmBufferGroup } from '../passKit.ts'
import { vsmBindGroupEntries, type VsmResources } from '../resources.ts'
import {
  createTessellationGroups,
  type TessInput,
} from '../../../../visibility/tessellation/groups.ts'
import {
  DISPATCH_DRAW,
  DISPATCH_DRAW_TWO_SIDED,
  DISPATCH_SEED,
  DISPATCH_SPLIT,
  MAX_SPLIT_LEVELS,
  PASS_DISPATCH_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { TESS_CHAIN_SHADOW } from '../../../../visibility/tessellation/uniform.ts'
import { readTessellationSetting } from '../../../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { tessellationWanted } from '../../../../visibility/tessellation/wanted.ts'
import {
  VSM_RENDER_TESSELLATE_DIRECTIONAL,
  VSM_RENDER_TESSELLATE_LOCAL,
} from '../render/renderParamsWgsl.ts'
import { vsmRenderContext, type VsmRenderContext } from '../render/renderPipes.ts'
import type { Tessellation } from '../../../../visibility/tessellation/tessellation.ts'
import { createShadowPrograms, type ShadowPrograms } from './shadowPrograms.ts'
import { VSM_TESS_PROJECTION_SPECS } from './shadowKernelsWgsl.ts'

/**
 * THE SHADOW MAPS' TESSELLATION OF A FRAME (`VsmShadowTessellation`), as the view passes of the
 * raster (`../render/renderEncode.ts`) drive it: a displaced surface's records are cut into patches, which
 * are diced and drawn in place of its triangles. It exists while the image tessellates
 * (`tessellationWanted`), a kind of light asks it (`tessellationShadowsDirectional`,
 * `tessellationShadowsLocal`) and every pipeline is compiled; otherwise the surface casts as the flat
 * triangles it is made of, the first frames on included.
 * - `kinds`: the kinds of light whose maps take it (`VSM_RENDER_TESSELLATE_*`);
 * - `begin`, before a view pass's compute pass: the chain's state cleared;
 * - `compute`, in it, once the pass's records are binned: the seeding, the six levels of splitting
 *   and the draw's arguments, over the pass's lists;
 * - `draw`, in the pass's raster pass, groups 0 and 1 set: the patches, an indirect draw for the
 *   one-sided rows and, where the table holds a two-sided surface, one for the two-sided rows.
 */
export interface VsmShadowTessellation {
  readonly kinds: number
  begin(encoder: GPUCommandEncoder): void
  compute(pass: GPUComputePassEncoder, lists: PassLists, offset: readonly number[]): void
  draw(pass: GPURenderPassEncoder): void
}

/** What a view pass's records are read from: its parameters' window, its counters and its records
 *  sorted by tier. */
type PassLists = {
  params: GPUBufferBinding
  counts: GPUBuffer
  sorted: GPUBuffer
}

/** The groups over a tessellation's buffers, made again with its instance. */
const groupsOf = new WeakMap<object, ReturnType<typeof createTessellationGroups>>()
/** The frame's geometry the groups read, rewritten in place. */
const geometry = {} as TessInput

/** The geometry and atlas the image's raster reads (`visibilityRasterStages`), its clusters the
 *  casters', or none while one is missing. */
function frameGeometry(rt: WebgpuPagesRuntime) {
  const { vis, gpu } = rt
  const { concatPos, concatUv, concatNrm, textures, mapsSampler } = vis
  // The decoded clusters of the casters the raster draws (`../../casters/casterFeed.ts`).
  const pageTable = rt.lights.casters?.pages
  const material = vis.materialTable.view
  if (
    !gpu.device ||
    !material ||
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
  geometry.material = material
  geometry.frame = vis.graphFrame.bufferOn(gpu.device)
  return geometry
}

/** The kinds of light whose maps take displaced surfaces tessellated, by the two settings. */
function kindsOf(rt: WebgpuPagesRuntime) {
  return (
    (readTessellationSetting(rt, 'tessellationShadowsDirectional')
      ? VSM_RENDER_TESSELLATE_DIRECTIONAL
      : 0) |
    (readTessellationSetting(rt, 'tessellationShadowsLocal') ? VSM_RENDER_TESSELLATE_LOCAL : 0)
  )
}

/** The group over the pass's lists, made again when one of the three buffers moved. */
function listsGroups(device: GPUDevice, programs: ShadowPrograms) {
  const held: { params?: GPUBuffer; counts?: GPUBuffer; sorted?: GPUBuffer; group?: GPUBindGroup } =
    {}
  return ({ params, counts, sorted }: PassLists) => {
    if (
      !held.group ||
      held.params !== params.buffer ||
      held.counts !== counts ||
      held.sorted !== sorted
    ) {
      Object.assign(held, { params: params.buffer, counts, sorted })
      held.group = vsmBufferGroup(device, programs.layouts.lists, [params, counts, sorted])
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
  /** Whether the table holds a two-sided surface: the draw of its rows' patches is made. */
  twoSided: boolean
}

/** The seeding over the pass's records, the six levels of splitting and the draw's arguments, in
 *  `pass`, over the pass's lists group `lists` at the parameters' `offset`. */
function encodeChain(
  pass: GPUComputePassEncoder,
  programs: ShadowPrograms,
  { shadow, groups, input, projections }: ChainFrame,
  lists: GPUBindGroup,
  offset: readonly number[],
) {
  const { dispatch } = shadow.resources
  const at = (word: number) => (TESS_CHAIN_SHADOW * PASS_DISPATCH_WORDS + word) * 4
  const [seedArgs, seed, plan, split, drawArgs] = [
    programs.seedArgs,
    programs.seed,
    programs.plan,
    programs.split,
    programs.drawArgs,
  ].map((stage) => stage.get())
  // The chain runs whole or not at all: each step reads what the one before wrote.
  if (!seedArgs || !seed || !plan || !split || !drawArgs) return
  const planned = groups.of('plan', TESS_CHAIN_SHADOW, input)
  const launch = (pipeline: GPUComputePipeline) => {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, planned)
    pass.setBindGroup(1, lists, offset)
    pass.dispatchWorkgroups(1)
  }
  launch(seedArgs)
  pass.setPipeline(seed)
  pass.setBindGroup(0, groups.of('shadowSeed', TESS_CHAIN_SHADOW, input))
  pass.setBindGroup(1, lists, offset)
  pass.dispatchWorkgroupsIndirect(dispatch, at(DISPATCH_SEED))
  const splitGroup = groups.of('shadowSplit', TESS_CHAIN_SHADOW, input)
  for (let level = 0; level < MAX_SPLIT_LEVELS; level++) {
    pass.setPipeline(plan)
    pass.setBindGroup(0, planned)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(split)
    pass.setBindGroup(0, splitGroup)
    pass.setBindGroup(1, lists, offset)
    pass.setBindGroup(2, projections)
    pass.dispatchWorkgroupsIndirect(dispatch, at(DISPATCH_SPLIT))
  }
  launch(drawArgs)
}

/** The chain of a raster context: its pipelines, made the first time a frame asks, the groups it
 *  binds, kept while what they name stands, and what the frame set (`bind`). */
function createShadowChain(ctx: VsmRenderContext) {
  const programs = createShadowPrograms(
    ctx.device,
    ctx.layout,
    ctx.pageLayout,
    ctx.raster.layout1,
    ctx.held,
  )
  const listsGroup = listsGroups(ctx.device, programs),
    projectionGroup = projectionGroups(ctx.device, programs)
  let frame: ChainFrame
  const chain: VsmShadowTessellation & {
    programs: ShadowPrograms
    bind(
      shadow: Tessellation['shadow'],
      input: TessInput,
      res: VsmResources,
      kinds: number,
      twoSided: boolean,
    ): void
  } = {
    get kinds() {
      return frame.kinds
    },
    programs,
    bind(shadow, input, res, kinds, twoSided) {
      let groups = groupsOf.get(shadow.resources)
      if (!groups)
        groupsOf.set(
          shadow.resources,
          (groups = createTessellationGroups(ctx.device, programs.layouts, {
            resources: shadow.resources,
          })),
        )
      frame = { shadow, groups, input, projections: projectionGroup(res), kinds, twoSided }
    },
    begin: (encoder) => frame.shadow.clear(encoder),
    compute: (pass, lists, offset) => encodeChain(pass, programs, frame, listsGroup(lists), offset),
    draw(pass) {
      const { shadow, groups, input, twoSided } = frame
      const [oneSidedPipe, twoSidedPipe] = [programs.raster.get(), programs.rasterTwoSided.get()]
      if (!oneSidedPipe || (twoSided && !twoSidedPipe)) return
      const at = (word: number) => (TESS_CHAIN_SHADOW * PASS_DISPATCH_WORDS + word) * 4
      pass.setPipeline(oneSidedPipe)
      pass.setBindGroup(2, groups.of(programs.rasterProgram, TESS_CHAIN_SHADOW, input))
      pass.drawIndirect(shadow.resources.dispatch, at(DISPATCH_DRAW))
      if (!twoSided) return
      pass.setPipeline(twoSidedPipe!)
      pass.drawIndirect(shadow.resources.dispatch, at(DISPATCH_DRAW_TWO_SIDED))
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
  const ctx = vsmRenderContext(vsm.res, device, pageLayout, rt.vis.rasters)
  let chain = chains.get(ctx)
  if (!chain) chains.set(ctx, (chain = createShadowChain(ctx)))
  const twoSided = rt.vis.materialTable.twoSided
  if (!chain.programs.ask(twoSided)) {
    vsm.renderedPlan = undefined
    return undefined
  }
  const { shadow } = tessellation
  shadow.prepare(
    rt.vis.materialTable.displaced,
    {
      tessellationDicingRate: readTessellationSetting(rt, 'tessellationDicingRate'),
      tessellationMaxPatchesPerGroup: readTessellationSetting(rt, 'tessellationMaxPatchesPerGroup'),
    },
    rt.run.selectionUniforms.pixelError,
  )
  chain.bind(shadow, input, vsm.res, kinds, twoSided)
  return chain
}
