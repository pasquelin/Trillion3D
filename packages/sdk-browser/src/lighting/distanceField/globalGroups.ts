import { wholeBuffer } from '../../gpu/core/computeBindings.ts'
import { CLIP_BLOCK } from './clipmapBlock.ts'
import { CULL_BLOCK } from './cullWgsl.ts'
import { MIP_BLOCK } from './mipWgsl.ts'
import type { GlobalPipelines } from './globalPipelines.ts'
import type { GlobalResources } from './globalResources.ts'

/**
 * THE BIND GROUPS OF THE GLOBAL DISTANCE FIELD'S PASSES over a set of resources, made when the
 * resources are made again or the list of culled objects grows. The two caches differ in the
 * tables a pass names: the static one's own table; the movable one's own, the combined one the
 * programs read, and the static one under it. Where the cache has no table under it, a table of one
 * texel stands in the binding, read or written by no pass. The page atlas is bound as the texture
 * where the field keeps one (`textured`), else as the buffer.
 */

/** What the groups of one cache bind. */
interface CacheBinds {
  readonly device: GPUDevice
  readonly layouts: GlobalPipelines['layouts']
  readonly res: GlobalResources
  readonly cache: 'static' | 'full'
  readonly own: GPUTexture
  readonly below: GPUTexture
  readonly combined: GPUTexture | undefined
  readonly clip: { buffer: GPUBuffer; size: number }
  readonly atlas: GPUTextureView | GPUBufferBinding
}

const view = (texture: GPUTexture) => texture.createView({ dimension: '3d' })

/** The bindings every pass starts with: the clipmap's block and the list of the tiles. */
const clipTilesEntries = ({ clip, res }: CacheBinds): GPUBindGroupEntry[] => [
  { binding: 0, resource: clip },
  { binding: 1, resource: wholeBuffer(res.tiles) },
]

/** The groups of the allocation and of the composition. */
function composeGroups(binds: CacheBinds) {
  const { device, layouts, res, cache, own, below, combined, atlas } = binds
  const { tables } = res
  return {
    allocate: device.createBindGroup({
      label: `Trillion3D global distance field allocation, ${cache}`,
      layout: layouts.allocate,
      entries: [
        ...clipTilesEntries(binds),
        { binding: 2, resource: view(own) },
        { binding: 3, resource: view(combined ?? tables.unusedWrite) },
        { binding: 4, resource: view(below) },
        { binding: 5, resource: wholeBuffer(res.control) },
        { binding: 6, resource: wholeBuffer(res.lists) },
        { binding: 7, resource: wholeBuffer(res.cull) },
      ],
    }),
    compose: device.createBindGroup({
      label: `Trillion3D global distance field composition, ${cache}`,
      layout: layouts.compose,
      entries: [
        ...clipTilesEntries(binds),
        { binding: 2, resource: wholeBuffer(res.cull) },
        { binding: 3, resource: atlas },
        { binding: 4, resource: view(combined ?? own) },
        { binding: 5, resource: view(below) },
      ],
    }),
  }
}

/** The groups of the coverage and of the object grid. */
function coverageGroups(binds: CacheBinds) {
  const { device, layouts, res, cache, own, below, combined, atlas } = binds
  return {
    coverage: device.createBindGroup({
      label: `Trillion3D global distance field coverage, ${cache}`,
      layout: layouts.coverage,
      entries: [
        ...clipTilesEntries(binds),
        { binding: 2, resource: wholeBuffer(res.cull) },
        { binding: 3, resource: atlas },
        { binding: 4, resource: view(below) },
        { binding: 5, resource: view(combined ?? own) },
        ...(res.textured ? [{ binding: 6, resource: wholeBuffer(res.atlas) }] : []),
      ],
    }),
    objectGrid: device.createBindGroup({
      label: `Trillion3D global distance field object grid, ${cache}`,
      layout: layouts.objectGrid,
      entries: [
        ...clipTilesEntries(binds),
        { binding: 2, resource: wholeBuffer(res.cull) },
        { binding: 3, resource: wholeBuffer(res.objectGrid) },
        { binding: 4, resource: view(own) },
        { binding: 5, resource: view(below) },
      ],
    }),
  }
}

/** The groups of the passes of one cache. */
function cacheGroups(
  device: GPUDevice,
  pipelines: GlobalPipelines,
  res: GlobalResources,
  cache: 'static' | 'full',
) {
  const { tables } = res
  const binds: CacheBinds = {
    device,
    layouts: pipelines.layouts,
    res,
    cache,
    own: cache === 'static' ? tables.static : tables.full,
    below: cache === 'full' && tables.combined ? tables.static : tables.unusedRead,
    combined: cache === 'full' && tables.combined ? tables.combined : undefined,
    clip: { buffer: res.blocks, size: CLIP_BLOCK.words * 4 },
    atlas: res.textured ? view(res.atlasTexture) : wholeBuffer(res.atlas),
  }
  return { ...composeGroups(binds), ...coverageGroups(binds) }
}

/** The groups of the list passes: each binds, as its arguments, a buffer that none of its dispatches
 *  is made by — the arguments of the updates, those of the return, a buffer unused. */
function listGroups(device: GPUDevice, pipelines: GlobalPipelines, res: GlobalResources) {
  const clip = { buffer: res.blocks, size: CLIP_BLOCK.words * 4 }
  const make = (args: GPUBuffer, label: string) =>
    device.createBindGroup({
      label,
      layout: pipelines.layouts.lists,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: wholeBuffer(res.control) },
        { binding: 2, resource: wholeBuffer(res.lists) },
        { binding: 3, resource: wholeBuffer(args) },
      ],
    })
  return {
    updates: make(res.args, 'Trillion3D global distance field page lists, updates'),
    returned: make(res.returnArgs, 'Trillion3D global distance field page lists, return'),
    idle: make(res.idle, 'Trillion3D global distance field page lists, dispatch'),
  }
}

/** The mip's groups: the first reads the page tables and writes the mip, the next two alternate. */
function mipGroups(device: GPUDevice, pipelines: GlobalPipelines, res: GlobalResources) {
  const block = { buffer: res.mipBlocks, size: MIP_BLOCK.words * 4 }
  const make = (from: GPUTexture, to: GPUTexture, label: string) =>
    device.createBindGroup({
      label,
      layout: pipelines.layouts.mip,
      entries: [
        { binding: 0, resource: block },
        { binding: 1, resource: view(res.read) },
        { binding: 2, resource: res.textured ? view(res.atlasTexture) : wholeBuffer(res.atlas) },
        { binding: 3, resource: view(from) },
        { binding: 4, resource: view(to) },
        ...(res.textured ? [{ binding: 5, resource: res.atlasSampler }] : []),
      ],
    })
  return {
    intoMip: make(res.mipTemp, res.mip, 'Trillion3D global distance field mip into the mip'),
    intoTemp: make(
      res.mip,
      res.mipTemp,
      'Trillion3D global distance field mip into the volume beside it',
    ),
  }
}

/** Every group of the field's passes. */
export function createGlobalGroups(
  device: GPUDevice,
  pipelines: GlobalPipelines,
  res: GlobalResources,
) {
  const { layouts } = pipelines
  const clip = { buffer: res.blocks, size: CLIP_BLOCK.words * 4 }
  const objects = res.objects!
  return {
    cull: device.createBindGroup({
      label: 'Trillion3D global distance field culling to clipmaps',
      layout: layouts.cull,
      entries: [
        { binding: 0, resource: { buffer: res.cullBlocks, size: CULL_BLOCK.words * 4 } },
        { binding: 1, resource: wholeBuffer(res.packed) },
        { binding: 2, resource: wholeBuffer(objects) },
        { binding: 3, resource: wholeBuffer(res.control) },
      ],
    }),
    tiles: device.createBindGroup({
      label: 'Trillion3D global distance field tiles',
      layout: layouts.tiles,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: wholeBuffer(res.bounds) },
        { binding: 2, resource: wholeBuffer(res.tiles) },
        { binding: 3, resource: wholeBuffer(res.control) },
      ],
    }),
    grid: device.createBindGroup({
      label: 'Trillion3D global distance field culling grid',
      layout: layouts.grid,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: wholeBuffer(objects) },
        { binding: 2, resource: wholeBuffer(res.tiles) },
        { binding: 3, resource: wholeBuffer(res.control) },
        { binding: 4, resource: wholeBuffer(res.cull) },
      ],
    }),
    lists: listGroups(device, pipelines, res),
    static: cacheGroups(device, pipelines, res, 'static'),
    full: cacheGroups(device, pipelines, res, 'full'),
    mip: mipGroups(device, pipelines, res),
    fill: [res.tables.static, res.tables.full, res.tables.combined]
      .filter((table): table is GPUTexture => !!table)
      .map((table) => ({
        group: device.createBindGroup({
          layout: layouts.fill,
          entries: [{ binding: 0, resource: table.createView({ dimension: '3d' }) }],
        }),
        size: [table.width, table.height, table.depthOrArrayLayers] as const,
      })),
  }
}

export type GlobalGroups = ReturnType<typeof createGlobalGroups>
