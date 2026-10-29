import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { vsmBufferGroup } from '../passKit.ts'
import {
  vsmBindGroupEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmResources,
} from '../resources.ts'
import {
  createTessellationGroups,
  type TessInput,
} from '../../../../visibility/tessellation/groups.ts'
import {
  DISPATCH_RESUME,
  DISPATCH_SEED,
  DISPATCH_SPLIT,
  DISPATCH_WINDOWS,
  MAX_SPLIT_LEVELS,
  dispatchOffset,
} from '../../../../visibility/tessellation/contract.ts'
import {
  TESS_CHAIN_SHADOW,
  TESS_CHAIN_SHADOW_POST,
} from '../../../../visibility/tessellation/uniform.ts'
import { readTessellationSetting } from '../../../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { shadowLodScale } from '../frame/shadowLodScale.ts'
import { tessellationWanted } from '../../../../visibility/tessellation/wanted.ts'
import {
  VSM_RENDER_TESSELLATE_DIRECTIONAL,
  VSM_RENDER_TESSELLATE_LOCAL,
} from '../render/renderParamsWgsl.ts'
import { vsmRenderContext, type VsmRenderContext } from '../render/renderPipes.ts'
import type { Tessellation } from '../../../../visibility/tessellation/tessellation.ts'
import { createShadowPrograms, type ShadowPrograms } from './shadowPrograms.ts'
import { VSM_TESS_PROJECTION_SPECS } from './shadowKernelsWgsl.ts'
import { DICE_LAYERS, VSM_TESS_DICE_POOL_BINDING, VSM_TESS_DICE_SPECS } from './shadowDiceWgsl.ts'
import { VSM_WINDOW_BIAS_BINDING, VSM_WINDOW_SPECS } from './shadowWindowWgsl.ts'

/**
 * THE SHADOW MAPS' TESSELLATION OF A FRAME (`VsmShadowTessellation`), as the view passes of the
 * raster (`../render/renderEncode.ts`) drive it: a displaced surface's records are cut into patches, which
 * are diced and rastered in software, in place of its triangles. It exists while the image tessellates
 * (`tessellationWanted`), a kind of light asks it (`tessellationShadowsDirectional`,
 * `tessellationShadowsLocal`) and every pipeline is compiled; otherwise the surface casts as the flat
 * triangles it is made of, the first frames on included.
 * - `kinds`: the kinds of light whose maps take it (`VSM_RENDER_TESSELLATE_*`);
 * - `bias`, once a frame's view passes begin: the buffer the windows' draw bias is read from, the classic atlas's or zeros;
 * - `sight`, once a frame that keeps the previous frame's pyramid begins its view passes: the chains test the patches against it;
 * - `begin`, before a view pass's compute pass, or before the post pass of a view pass the pyramid is built over (`post`):
 *   the chain's state cleared — the main pass's, which holds the patches its occlusion test hid, kept through the post pass —;
 * - `compute`, in the pass, once its records are binned: the seeding, the six levels of splitting, the dicing's
 *   arguments and the fill of the windows the seeding opened, over the pass's lists, under the occlusion group `occlusion` (the previous
 *   frame's pyramid for the main pass, this frame's for the post pass, which first takes up the patches the main pass hid);
 * - `dice`, in a compute pass after the pass's raster, `pageCompute` the shadow page group's compute twin: the patches the
 *   chain listed visible, diced and rastered into the pool, a dispatch for the dynamic layer's and, where the maps keep a
 *   static layer, one for the static layer's.
 */
export interface VsmShadowTessellation {
  readonly kinds: number
  sight(): void
  bias(buffer: GPUBuffer): void
  begin(encoder: GPUCommandEncoder, post: boolean): void
  compute(
    pass: GPUComputePassEncoder,
    post: boolean,
    lists: PassLists,
    offset: readonly number[],
    occlusion: GPUBindGroup,
  ): void
  dice(pass: GPUComputePassEncoder, post: boolean, pageCompute: GPUBindGroup): void
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

/** The group over a buffer the windows' draw bias is read from, made once for each buffer. */
function biasGroupsOf(device: GPUDevice, programs: ShadowPrograms) {
  const held = new WeakMap<GPUBuffer, GPUBindGroup>()
  return (buffer: GPUBuffer) => {
    let group = held.get(buffer)
    if (!group)
      held.set(
        buffer,
        (group = device.createBindGroup({
          layout: programs.layouts.bias,
          entries: [{ binding: VSM_WINDOW_BIAS_BINDING, resource: { buffer } }],
        })),
      )
    return group
  }
}

/** The groups over the frame set the chain binds: the maps' projections and uniforms (the seeding, the resume
 *  and the splitting), the projections, page table and uniforms (the fill of the windows) and, for each layer
 *  of the pool, its slice and the uniforms (the dicing). Made for each of the two sets that take turns, again only when one moved
 *  (`vsmPerFrameSet`). */
function frameGroups(device: GPUDevice, programs: ShadowPrograms) {
  const { layouts } = programs
  const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({ layout, entries })
  const held = vsmFrameSetHeld<{
    projections: GPUBindGroup
    windows: GPUBindGroup
    pools: GPUBindGroup[]
  }>()
  const make = (res: VsmResources) => ({
    projections: group(layouts.projections, vsmBindGroupEntries(res, VSM_TESS_PROJECTION_SPECS)),
    windows: group(layouts.windows, vsmBindGroupEntries(res, VSM_WINDOW_SPECS)),
    // The static layer's slice is bound where the maps keep their pages from frame to frame.
    pools: DICE_LAYERS.slice(0, res.layout.cacheEnabled ? DICE_LAYERS.length : 1).map((_, layer) =>
      group(layouts.pool, [
        { binding: VSM_TESS_DICE_POOL_BINDING, resource: { buffer: res.pagePool[layer]! } },
        ...vsmBindGroupEntries(res, VSM_TESS_DICE_SPECS.slice(1)),
      ]),
    ),
  })
  return (res: VsmResources) => vsmPerFrameSet(held, res, make, undefined, res.pagePool)
}

/** What a frame sets of the chain: the instance whose buffers it runs in, the groups over them, the
 *  geometry and the groups over the frame set (`frameGroups`), and the kinds of light that take it. */
type ChainFrame = {
  shadow: Tessellation['shadow']
  groups: ReturnType<typeof createTessellationGroups>
  input: TessInput
  frame: ReturnType<ReturnType<typeof frameGroups>>
  kinds: number
  /** The bind group over the buffer the windows' draw bias is read from (`bias`). */
  bias?: GPUBindGroup
}

/** The chain a pass runs in: the main pass's, or the post pass's. */
const chainOf = (post: boolean) => (post ? TESS_CHAIN_SHADOW_POST : TESS_CHAIN_SHADOW)

/** The seeding over the pass's records, in the post pass the resume of the patches the main pass hid, the six levels of splitting, the
 *  dicing's arguments and the fill of the windows, in `pass`, over the pass's lists group `lists` at the parameters' `offset`, under the
 *  occlusion group `occlusion`. */
function encodeChain(
  pass: GPUComputePassEncoder,
  programs: ShadowPrograms,
  { shadow, groups, input, frame }: ChainFrame,
  bias: GPUBindGroup,
  post: boolean,
  lists: GPUBindGroup,
  offset: readonly number[],
  occlusion: GPUBindGroup,
) {
  const { dispatch } = shadow.resources
  const chain = chainOf(post)
  const { seedArgs, seed, plan, split, shadowArgs, windowFill, resume } = programs.pipelines
  const planned = groups.of('plan', chain, input)
  const splitGroup = groups.of('shadowSplit', chain, input)
  // The lists, the maps' projections and the occlusion are the same for every kernel of the chain: set once, only group 0 changes.
  pass.setBindGroup(1, lists, offset)
  pass.setBindGroup(2, frame.projections)
  pass.setBindGroup(3, occlusion)
  pass.setPipeline(seedArgs)
  pass.setBindGroup(0, planned)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(seed)
  pass.setBindGroup(0, splitGroup)
  pass.dispatchWorkgroupsIndirect(dispatch, dispatchOffset(chain, DISPATCH_SEED))
  if (post) {
    pass.setPipeline(resume)
    pass.setBindGroup(0, splitGroup)
    pass.dispatchWorkgroupsIndirect(dispatch, dispatchOffset(chain, DISPATCH_RESUME))
  }
  for (let level = 0; level < MAX_SPLIT_LEVELS; level++) {
    launchPlan(pass, plan, planned)
    pass.setPipeline(split)
    pass.setBindGroup(0, splitGroup)
    pass.dispatchWorkgroupsIndirect(dispatch, dispatchOffset(chain, DISPATCH_SPLIT))
  }
  launchPlan(pass, shadowArgs, planned)
  pass.setPipeline(windowFill)
  pass.setBindGroup(0, groups.of('shadowWindow', chain, input))
  pass.setBindGroup(1, frame.windows)
  pass.setBindGroup(2, bias)
  pass.dispatchWorkgroupsIndirect(dispatch, dispatchOffset(chain, DISPATCH_WINDOWS))
}

/** A one-thread kernel over the chain's state alone, over the group `planned`. */
function launchPlan(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  planned: GPUBindGroup,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, planned)
  pass.dispatchWorkgroups(1)
}

/** The chain of a raster context: its pipelines, made the first time a frame asks, the groups it
 *  binds, kept while what they name stands, and what the frame set (`bind`). */
function createShadowChain(ctx: VsmRenderContext) {
  const programs = createShadowPrograms(ctx.device, ctx.layout, ctx.held)
  const listsGroup = listsGroups(ctx.device, programs),
    frameOf = frameGroups(ctx.device, programs)
  const biasGroups = biasGroupsOf(ctx.device, programs)
  let current: ChainFrame
  const chain: VsmShadowTessellation & {
    programs: ShadowPrograms
    bind(shadow: Tessellation['shadow'], input: TessInput, res: VsmResources, kinds: number): void
  } = {
    get kinds() {
      return current.kinds
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
      current = {
        shadow,
        groups,
        input,
        frame: frameOf(res),
        kinds,
      }
    },
    bias(buffer) {
      current.bias = biasGroups(buffer)
    },
    sight: () => current.shadow.sight(),
    begin: (encoder, post) => current.shadow.clear(encoder, post),
    compute: (pass, post, lists, offset, occlusion) =>
      encodeChain(
        pass,
        programs,
        current,
        current.bias!,
        post,
        listsGroup(lists),
        offset,
        occlusion,
      ),
    dice(pass, post, pageCompute) {
      const { shadow, groups, input, frame } = current
      const which = chainOf(post)
      pass.setBindGroup(0, pageCompute)
      pass.setBindGroup(1, groups.of('shadowDice', which, input))
      // Each layer's patches lie in a list of their own, the arguments of its dispatch the chain's.
      DICE_LAYERS.forEach(({ dispatchWord }, layer) => {
        const pool = frame.pools[layer]
        if (!pool) return
        pass.setPipeline(programs.pipelines.dice[layer]!)
        pass.setBindGroup(2, pool)
        pass.dispatchWorkgroupsIndirect(
          shadow.resources.dispatch,
          dispatchOffset(which, dispatchWord),
        )
      })
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
  if (!chain.programs.ask()) {
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
    shadowLodScale(rt),
  )
  chain.bind(shadow, input, vsm.res, kinds)
  return chain
}
