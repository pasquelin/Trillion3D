/**
 * THE CLASSIC SHADOW MAPS' DEPTH PASSES (`shadowVirtualEnable` off), in the order of the reference's depth atlas: the atlas cleared (`ClearShadowDepth`), the cached depths copied into
 * the tiles (`CopyCachedShadowMap`: a triangle over each tile, `atlasCopyWgsl.ts`), the casters drawn over them with a depth test (`atlasRasterWgsl.ts`), then the tiles joined to the
 * pool the readers sample (`vsmAtlasCopyOut`). The atlas has a layer for the dynamic casters and, where the pages are cached, one for the static casters; each layer is its own render
 * pass over the records of its own, sorted by page and layer after the cull's bin (`atlasBinWgsl.ts`). The voxel rows keep the pool raster (`renderEncode.ts`); the software raster is off in a classic frame (`rasterSettings`), every cluster being drawn here with the map's depth bias:
 * the copy out joins by maximum, so what the voxel rows wrote to the pool stays.
 */
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../../../gpu/core/computeBindings.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { NO_RASTERS, type GraphRasters } from '../../../../materials/graph/graphRasters.ts'
import { shadowMasks } from '../../../../visibility/shader/maskSets.ts'
import { shadowWpo } from '../../../../visibility/shader/wpoSets.ts'
import { preparedPipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { vsmBufferGroup, vsmComputePipe, type VsmComputePipe } from '../../vsm/passKit.ts'
import {
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from '../../vsm/render/renderRasterWgsl.ts'
import { TIERS, madeLater, RENDER_LABEL } from '../../vsm/render/renderPipes.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_FAMILY,
  vsmRenderTierCorners,
  vsmRenderTierFamily,
} from '../../vsm/render/renderParamsWgsl.ts'
import type { VsmLayout } from '../../vsm/layout.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmSpecGroup,
  type VsmResources,
} from '../../vsm/resources.ts'
import { atlasTileAt, type AtlasPlan } from './atlasPlan.ts'
import {
  ATLAS_COPY_ATLAS_BINDING,
  ATLAS_COPY_GROUPS_ACROSS,
  atlasCopySpecs,
  vsmAtlasCopyInWgsl,
  vsmAtlasCopyOutWgsl,
} from './atlasCopyWgsl.ts'
import { ATLAS_DEPTH_FORMAT, vsmAtlasRasterWgsl } from './atlasRasterWgsl.ts'
import { ATLAS_RASTER_BINDING } from './atlasTileWgsl.ts'
import {
  ATLAS_BIN_ATLAS_BINDING,
  ATLAS_BIN_COUNT_ENTRY,
  ATLAS_BIN_OFFSETS_ENTRY,
  ATLAS_BIN_SCATTER_ENTRY,
  ATLAS_BIN_TIERS,
  atlasBinCountWords,
  atlasBinDrawOffset,
  vsmAtlasBinWgsl,
} from './atlasBinWgsl.ts'

const LABEL = `${RENDER_LABEL}.atlas`
/** The stages of the vertex and the fragment, read where a layout is made (the GPU globals do not exist at load). */
const vertexFragment = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT

/** The tiers the atlas draws: those of the one-sided and two-sided families (the voxel rows keep the pool raster). */
export const atlasTiers = (drawn: readonly number[]) =>
  drawn.filter((t) => vsmRenderTierFamily(t) !== VSM_RENDER_FAMILY.voxel)

/** The tiers the pool raster still draws in a classic frame: the voxel rows'. */
export const poolTiers = (drawn: readonly number[]) =>
  drawn.filter((t) => vsmRenderTierFamily(t) === VSM_RENDER_FAMILY.voxel)

interface AtlasTexture {
  texture: GPUTexture
  /** One 2D view a layer, for the attachments. */
  layers: GPUTextureView[]
  array: GPUTextureView
  width: number
  height: number
}

/** The atlas's pipelines and texture of a raster context: the casters' draw a layer and tier, the copy in a layer, the layouts, and the depth texture held. */
export interface AtlasRaster {
  device: GPUDevice
  layout: VsmLayout
  raster1: GPUBindGroupLayout
  copyGroup: GPUBindGroupLayout
  /** The casters' pipelines, a tier each (undefined for a voxel tier), made when first asked. */
  tiers: (PreparedPipeline<GPURenderPipeline> | undefined)[]
  /** The second sort's pipes by the texture layers they sort into, and its buffers (the second list, the counts, the draw arguments), grown as the frame needs. */
  sort: Map<number, VsmComputePipe[]>
  sortBuffers?: {
    sorted: GPUBuffer
    counts: GPUBuffer
    draws: GPUBuffer
    sortedBytes: number
    buckets: number
  }
  copyIn: PreparedPipeline<GPURenderPipeline>[]
  /** The copy out's pipe by the layers it joins (its text is assembled once). */
  copyOut: Map<number, VsmComputePipe>
  texture?: AtlasTexture
  destroy(): void
}

/** The casters' pipelines: a tier a pipeline, the one-sided rows' culling the back faces, the two-sided rows' none. */
function casterTiers(device: GPUDevice, module: GPUShaderModule, layout: GPUPipelineLayout) {
  return TIERS.map((t) => {
    const family = vsmRenderTierFamily(t)
    if (family === VSM_RENDER_FAMILY.voxel) return undefined
    const make = () =>
      preparedPipeline(device, {
        label: `${LABEL}.raster.${t}`,
        layout,
        vertex: {
          module,
          entryPoint: 'vsmRenderVs',
          constants: { VSM_RENDER_CORNERS: vsmRenderTierCorners(t) },
        },
        fragment: { module, entryPoint: 'vsmRenderFs', targets: [] },
        primitive: {
          topology: 'triangle-list',
          frontFace: 'ccw',
          cullMode: family === VSM_RENDER_FAMILY.twoSided ? 'none' : 'back',
        },
        depthStencil: {
          format: ATLAS_DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: 'greater',
        },
      })
    // A tier is compiled when a frame first draws it.
    return madeLater(make)
  })
}

/** The atlas's pipelines for `layout` on the shadow page group `pageLayout`, its cutouts and offsets the session's (`held`). */
export function createAtlasRaster(
  device: GPUDevice,
  layout: VsmLayout,
  pageLayout: GPUBindGroupLayout,
  held: GraphRasters = NO_RASTERS,
): AtlasRaster {
  const raster1 = device.createBindGroupLayout({
    label: `${LABEL}.raster1`,
    entries: [
      computeBufferEntry(0, 'read-only-storage', GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_VERTEX_SPECS, GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_SHARED_SPECS, vertexFragment()),
      computeBufferEntry(ATLAS_RASTER_BINDING, 'read-only-storage', vertexFragment()),
    ],
  })
  const rasterModule = device.createShaderModule({
    label: `${LABEL}.raster`,
    code: vsmAtlasRasterWgsl(layout, shadowMasks(held), shadowWpo(held)),
  })
  const rasterLayout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, raster1] })
  const copyGroup = device.createBindGroupLayout({
    label: `${LABEL}.copy`,
    entries: [
      computeBufferEntry(ATLAS_COPY_ATLAS_BINDING, 'read-only-storage', GPUShaderStage.FRAGMENT),
      ...vsmBindGroupLayoutEntries(atlasCopySpecs('read'), GPUShaderStage.FRAGMENT),
    ],
  })
  const copyModule = device.createShaderModule({
    label: `${LABEL}.copyIn`,
    code: vsmAtlasCopyInWgsl(layout),
  })
  const copyLayout = device.createPipelineLayout({ bindGroupLayouts: [copyGroup] })
  const copyIn = [0, 1].map((layer) =>
    preparedPipeline(device, {
      label: `${LABEL}.copyIn${layer}`,
      layout: copyLayout,
      vertex: { module: copyModule, entryPoint: 'vsmAtlasCopyVs' },
      fragment: {
        module: copyModule,
        entryPoint: 'vsmAtlasCopyFs',
        targets: [],
        constants: { ATLAS_STATIC: layer },
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: ATLAS_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
    }),
  )
  const atlas: AtlasRaster = {
    device,
    layout,
    raster1,
    copyGroup,
    tiers: casterTiers(device, rasterModule, rasterLayout),
    sort: new Map(),
    copyIn,
    copyOut: new Map(),
    destroy() {
      atlas.texture?.texture.destroy()
      atlas.texture = undefined
      destroySortBuffers(atlas)
    },
  }
  return atlas
}

/** The copy out's pipe for `layers` layers, made the first time it is asked. */
function copyOutPipe(atlas: AtlasRaster, layers: number) {
  let pipe = atlas.copyOut.get(layers)
  if (!pipe) {
    pipe = vsmComputePipe(
      atlas.device,
      `${LABEL}.copyOut`,
      vsmAtlasCopyOutWgsl(atlas.layout),
      'vsmAtlasCopyOut',
      [
        [
          computeBufferEntry(ATLAS_COPY_ATLAS_BINDING, 'read-only-storage'),
          ...vsmBindGroupLayoutEntries(atlasCopySpecs('atomic'), COMPUTE),
        ],
        [computeTextureEntry(0, 'depth', '2d-array')],
      ],
      { ATLAS_LAYERS: layers },
    )
    atlas.copyOut.set(layers, pipe)
  }
  return pipe
}

/** The second sort's three pipes (count, offsets, scatter) for `buckets` texture layers of `layers` a page, made the first time they are asked. */
function sortPipes(atlas: AtlasRaster, buckets: number, layers: number) {
  let pipes = atlas.sort.get(buckets * 4 + layers)
  if (!pipes) {
    const code = vsmAtlasBinWgsl()
    const groups = [
      [
        computeBufferEntry(ATLAS_BIN_ATLAS_BINDING, 'read-only-storage'),
        computeBufferEntry(1, 'read-only-storage'),
        computeBufferEntry(2, 'read-only-storage'),
        computeBufferEntry(3, 'storage'),
        computeBufferEntry(4, 'storage'),
        computeBufferEntry(5, 'storage'),
      ],
    ]
    pipes = [ATLAS_BIN_COUNT_ENTRY, ATLAS_BIN_OFFSETS_ENTRY, ATLAS_BIN_SCATTER_ENTRY].map((entry) =>
      vsmComputePipe(atlas.device, `${LABEL}.${entry}`, code, entry, groups, {
        ATLAS_BUCKETS: buckets,
        ATLAS_LAYERS: layers,
      }),
    )
    atlas.sort.set(buckets * 4 + layers, pipes)
  }
  return pipes
}

/** The second sort's buffers, made again only when the sorted list or the texture layers outgrow them; the old ones are retired. */
function sortBuffersFor(atlas: AtlasRaster, sortedBytes: number, buckets: number) {
  const held = atlas.sortBuffers
  if (held && held.sortedBytes >= sortedBytes && held.buckets >= buckets) return held
  destroySortBuffers(atlas)
  const make = (label: string, size: number, usage: number) =>
    atlas.device.createBuffer({ label: `${LABEL}.${label}`, size, usage })
  return (atlas.sortBuffers = {
    sorted: make('sorted', sortedBytes, GPUBufferUsage.STORAGE),
    counts: make(
      'counts',
      atlasBinCountWords(buckets) * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    draws: make(
      'draws',
      ATLAS_BIN_TIERS.length * buckets * 16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    ),
    sortedBytes,
    buckets,
  })
}

function destroySortBuffers(atlas: AtlasRaster) {
  const held = atlas.sortBuffers
  if (!held) return
  // The passes of this encoder may still name them: destroyed after the frame's submit.
  for (const b of [held.sorted, held.counts, held.draws]) retire(atlas.device, b)
  atlas.sortBuffers = undefined
}

/** The atlas texture for `layers` layers of at least `width` by `height`, held and made again only when it must grow or change its layers. */
function atlasTexture(atlas: AtlasRaster, width: number, height: number, layers: number) {
  const held = atlas.texture
  if (held && held.width >= width && held.height >= height && held.layers.length === layers)
    return held
  // The old texture may be named by passes already recorded in this encoder: it is retired, destroyed after the frame's submit.
  if (held) retire(atlas.device, held.texture)
  const w = Math.max(width, held?.width ?? 0)
  const h = Math.max(height, held?.height ?? 0)
  const texture = atlas.device.createTexture({
    label: `${LABEL}.depth`,
    size: [w, h, layers],
    format: ATLAS_DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  return (atlas.texture = {
    texture,
    layers: Array.from({ length: layers }, (_, layer) =>
      texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
    ),
    array: texture.createView({ dimension: '2d-array' }),
    width: w,
    height: h,
  })
}

/** What a frame of the atlas draws with: the plan (the tiles and the atlas's size), the atlas buffer, the maps there are and whether the static layer is kept. */
export interface AtlasFrame {
  plan: Pick<AtlasPlan, 'words' | 'width' | 'height' | 'pages' | 'left'>
  buffer: GPUBuffer
  mapCount: number
  cached: boolean
}

/** Frame state between the clear/copy in and the draws: the groups over the frame's tables. */
export interface AtlasPasses {
  atlas: AtlasRaster
  frame: AtlasFrame
  texture: AtlasTexture
  /** The second sort's buffers: the second list the draws read, the counts, the draw arguments. */
  sort: NonNullable<AtlasRaster['sortBuffers']>
  /** The cull's sorted list, which the second sort reads. */
  sorted: GPUBuffer
  raster1: GPUBindGroup
  out: { pipeline: GPUComputePipeline; group0: GPUBindGroup; group1: GPUBindGroup }
}

/** The tiles of a plan that were placed: map id, corner and side in the atlas. */
function placedTiles({ words }: Pick<AtlasPlan, 'words'>, mapCount: number) {
  const tiles: { map: number; x: number; y: number; side: number; page: number }[] = []
  for (let map = 0; map < mapCount; map++) {
    const at = atlasTileAt(map)
    if (words[at + 3])
      tiles.push({
        map,
        x: words[at]! & 0xffff,
        y: words[at]! >>> 16,
        side: words[at + 1]!,
        page: words[at + 7]!,
      })
  }
  return tiles
}

/**
 * The atlas cleared and filled from the pool, before the frame's view passes: each layer a render pass that clears its layer to zero and draws a triangle over each tile (the cached
 * depths copied in). Returns the passes' state for the draws and the copy out, none while a pipeline is still compiling (the frame draws the pool raster's way then, for no tile).
 */
export function beginAtlas(
  encoder: GPUCommandEncoder,
  atlas: AtlasRaster,
  res: VsmResources,
  frame: AtlasFrame,
  sorted: GPUBuffer,
): AtlasPasses | undefined {
  const { device } = atlas
  const layers = frame.cached ? 2 : 1
  const total = layers * frame.plan.pages
  const copyIns = atlas.copyIn.slice(0, layers).map((p) => p.get())
  const outPipe = copyOutPipe(atlas, layers)
  if (copyIns.some((p) => !p) || !outPipe.pipeline) return undefined
  const texture = atlasTexture(atlas, frame.plan.width, frame.plan.height, total)
  const sort = sortBuffersFor(atlas, sorted.size, total)
  const atlasEntry = { binding: ATLAS_COPY_ATLAS_BINDING, resource: { buffer: frame.buffer } }
  const copyIn = vsmSpecGroup(
    device,
    atlas.copyGroup,
    res,
    atlasCopySpecs('read'),
    `${LABEL}.copyIn`,
    [atlasEntry],
  )
  const tiles = placedTiles(frame.plan, frame.mapCount)
  for (let at = 0; at < total; at++) {
    const layer = at % layers
    const page = Math.floor(at / layers)
    const pass = encoder.beginRenderPass({
      label: `${LABEL}.clear${page}.${layer}`,
      colorAttachments: [],
      depthStencilAttachment: {
        view: texture.layers[at]!,
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })
    pass.setPipeline(copyIns[layer]!)
    pass.setBindGroup(0, copyIn)
    for (const t of tiles) {
      if (t.page !== page) continue
      pass.setViewport(t.x, t.y, t.side, t.side, 0, 1)
      pass.setScissorRect(t.x, t.y, t.side, t.side)
      pass.draw(3, 1, 0, t.map)
    }
    pass.end()
  }
  return {
    atlas,
    frame,
    texture,
    sort,
    sorted,
    raster1: device.createBindGroup({
      label: `${LABEL}.raster1`,
      layout: atlas.raster1,
      entries: [
        ...sequentialEntries([{ buffer: sort.sorted }]),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_VERTEX_SPECS),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_SHARED_SPECS),
        { binding: ATLAS_RASTER_BINDING, resource: { buffer: frame.buffer } },
      ],
    }),
    out: {
      pipeline: outPipe.pipeline,
      group0: vsmSpecGroup(
        device,
        outPipe.groups[0]!,
        res,
        atlasCopySpecs('atomic'),
        `${LABEL}.out0`,
        [atlasEntry],
      ),
      group1: device.createBindGroup({
        label: `${LABEL}.out1`,
        layout: outPipe.groups[1]!,
        entries: [{ binding: 0, resource: texture.array }],
      }),
    },
  }
}

/**
 * One raster call's draws into the atlas: the cull's sorted records sorted again by tile (`atlasBinWgsl.ts`), then for each layer a render pass that loads it and draws the tiers `drawn`
 * by `drawIndirect` over the records of its own. A tier still compiling is left out, as the pool raster leaves it. The tiles join the pool in `copyOutAtlas`.
 */
export function drawAtlas(
  encoder: GPUCommandEncoder,
  passes: AtlasPasses,
  label: string,
  drawn: readonly number[],
  pageGroup: GPUBindGroup,
  args: GPUBuffer,
) {
  const { atlas, frame, texture, sort } = passes
  const layers = frame.cached ? 2 : 1
  const buckets = texture.layers.length
  sortRecords(encoder, passes, label, args, layers)
  for (let at = 0; at < buckets; at++) {
    const pass = encoder.beginRenderPass({
      label: `${label}.atlas${Math.floor(at / layers)}.${at % layers}`,
      colorAttachments: [],
      depthStencilAttachment: {
        view: texture.layers[at]!,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    })
    pass.setViewport(0, 0, frame.plan.width, frame.plan.height, 0, 1)
    pass.setBindGroup(0, pageGroup)
    pass.setBindGroup(1, passes.raster1)
    for (const t of drawn) {
      const tier = atlas.tiers[t]?.get()
      if (!tier) continue
      pass.setPipeline(tier)
      // The tiers the atlas draws are the first of the list (`ATLAS_BIN_TIERS`), so a tier's number is its place.
      pass.drawIndirect(sort.draws, atlasBinDrawOffset(t, at, sort.buckets))
    }
    pass.end()
  }
}

/** The records of `args`' draws sorted by (tier, tile layer) into the second list, in a compute pass: clear the counts, count, lay the offsets and the draw arguments, scatter. */
function sortRecords(
  encoder: GPUCommandEncoder,
  { atlas, sort, sorted, frame }: AtlasPasses,
  label: string,
  args: GPUBuffer,
  layers: number,
) {
  const [count, offsets, scatter] = sortPipes(atlas, sort.buckets, layers)
  if (!count!.pipeline || !offsets!.pipeline || !scatter!.pipeline) return
  encoder.clearBuffer(sort.counts, 0, atlasBinCountWords(sort.buckets) * 4)
  const group = vsmBufferGroup(atlas.device, count!.groups[0]!, [
    { buffer: frame.buffer },
    args,
    sorted,
    sort.counts,
    sort.sorted,
    sort.draws,
  ])
  const pass = encoder.beginComputePass({ label: `${label}.atlasSort` })
  pass.setBindGroup(0, group)
  pass.setPipeline(count!.pipeline)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_BIN * 4)
  pass.setPipeline(offsets!.pipeline)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(scatter!.pipeline)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_BIN * 4)
  pass.end()
}

/** The tiles joined to the pool, in a compute pass: once an image after the last draw, or after each raster call that the occlusion pyramid is built over (it reads the pool). */
export function copyOutAtlas(encoder: GPUCommandEncoder, passes: AtlasPasses, label: string) {
  const out = encoder.beginComputePass({ label: `${label}.atlasOut` })
  out.setPipeline(passes.out.pipeline)
  out.setBindGroup(0, passes.out.group0)
  out.setBindGroup(1, passes.out.group1)
  out.dispatchWorkgroups(ATLAS_COPY_GROUPS_ACROSS, passes.frame.mapCount)
  out.end()
}
