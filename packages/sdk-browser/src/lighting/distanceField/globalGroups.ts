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
 * texel stands in the binding, read or written by no pass.
 */

const whole = (buffer: GPUBuffer) => ({ buffer })

/** The groups of the passes of one cache. */
function cacheGroups(
  device: GPUDevice,
  pipelines: GlobalPipelines,
  res: GlobalResources,
  cache: 'static' | 'full',
) {
  const { layouts } = pipelines
  const { tables } = res
  const own = cache === 'static' ? tables.static : tables.full
  const below = cache === 'full' && tables.combined ? tables.static : tables.unusedRead
  const combined = cache === 'full' && tables.combined ? tables.combined : undefined
  const clip = { buffer: res.blocks, size: CLIP_BLOCK.words * 4 }
  const view = (texture: GPUTexture) => texture.createView({ dimension: '3d' })
  return {
    allocate: device.createBindGroup({
      label: `Trillion3D global distance field allocation, ${cache}`,
      layout: layouts.allocate,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: whole(res.tiles) },
        { binding: 2, resource: view(own) },
        { binding: 3, resource: view(combined ?? tables.unusedWrite) },
        { binding: 4, resource: view(below) },
        { binding: 5, resource: whole(res.control) },
        { binding: 6, resource: whole(res.lists) },
        { binding: 7, resource: whole(res.cull) },
      ],
    }),
    compose: device.createBindGroup({
      label: `Trillion3D global distance field composition, ${cache}`,
      layout: layouts.compose,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: whole(res.tiles) },
        { binding: 2, resource: whole(res.cull) },
        { binding: 3, resource: whole(res.atlas) },
        { binding: 4, resource: view(combined ?? own) },
        { binding: 5, resource: view(below) },
      ],
    }),
  }
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
        { binding: 1, resource: whole(res.control) },
        { binding: 2, resource: whole(res.lists) },
        { binding: 3, resource: whole(args) },
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
  const view = (texture: GPUTexture) => texture.createView({ dimension: '3d' })
  const make = (from: GPUTexture, to: GPUTexture, label: string) =>
    device.createBindGroup({
      label,
      layout: pipelines.layouts.mip,
      entries: [
        { binding: 0, resource: block },
        { binding: 1, resource: view(res.read) },
        { binding: 2, resource: whole(res.atlas) },
        { binding: 3, resource: view(from) },
        { binding: 4, resource: view(to) },
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
        { binding: 1, resource: whole(res.packed) },
        { binding: 2, resource: whole(objects) },
        { binding: 3, resource: whole(res.control) },
      ],
    }),
    tiles: device.createBindGroup({
      label: 'Trillion3D global distance field tiles',
      layout: layouts.tiles,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: whole(res.bounds) },
        { binding: 2, resource: whole(res.tiles) },
        { binding: 3, resource: whole(res.control) },
      ],
    }),
    grid: device.createBindGroup({
      label: 'Trillion3D global distance field culling grid',
      layout: layouts.grid,
      entries: [
        { binding: 0, resource: clip },
        { binding: 1, resource: whole(objects) },
        { binding: 2, resource: whole(res.tiles) },
        { binding: 3, resource: whole(res.control) },
        { binding: 4, resource: whole(res.cull) },
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
