import { ceilDiv, floorLog2, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { mipOf, type AssetMip, type AtlasBudget, type AtlasState } from './atlasState.ts'
import type { AtlasStep } from './atlasRequests.ts'
import { writeAssetRecord } from './assetRecords.ts'
import { writeBricks } from './brickUpload.ts'
import {
  ASSET_MIP_STRIDE,
  ASSET_STRIDE,
  BRICK,
  INVALID_BRICK_INDEX,
  SCENE_BLOCK,
  UNIQUE_BRICK,
} from './layout.ts'
import { recordWords, type RecordWords } from './objectRecords.ts'

/**
 * THE GPU SIDE OF THE BRICK ATLAS: the 3D texture of bytes that holds the bricks (`sizeXY` bricks
 * along its first two axes, growing along the third), the buffer of the indirection tables, the
 * buffer of the meshes' records and the block of the scene. Each is made when the atlas first needs
 * it and again, larger, when it outgrows it — a buffer of a power of two of words, the texture of
 * the depth the blocks asked for (a power of two of bricks while it stays within the budget's depth,
 * a multiple of four past it) —, the one it replaces retired for the frame, and the texture's
 * bricks copied across before the frame's writes land. The host keeps a copy of the tables and the
 * records, so a buffer made again is written whole.
 */

/** The depth of the atlas, in bricks, `bricks` being what the blocks have held at once. */
function atlasDepth(bricks: number, budget: AtlasBudget) {
  const wanted = Math.max(1, ceilDiv(bricks, budget.sizeXY * budget.sizeXY))
  return wanted <= budget.maxDepth ? nextPow2(wanted) : ceilDiv(wanted, 4) * 4
}

/** The texture of the bricks, of `sizeXY` bricks a side and as many deep as asked. */
function createBrickTexture(device: GPUDevice, sizeXY: number) {
  let texture: GPUTexture | undefined
  /** Copies the bricks held into a texture that replaces them, before the frame's writes land. */
  const carry = (from: GPUTexture, to: GPUTexture) => {
    const encoder = device.createCommandEncoder({
      label: 'Trillion3D mesh distance field atlas growth',
    })
    const size = {
      width: from.width,
      height: from.height,
      depthOrArrayLayers: from.depthOrArrayLayers,
    }
    encoder.copyTextureToTexture({ texture: from }, { texture: to }, size)
    device.queue.submit([encoder.finish()])
    retire(device, from)
  }
  return {
    get texture() {
      return texture!
    },
    /** The depth in bricks. */
    get depth() {
      return texture ? texture.depthOrArrayLayers / BRICK : 0
    },
    /** The texture at `depth` bricks. */
    ensure(depth: number) {
      if (texture && texture.depthOrArrayLayers === depth * BRICK) return
      const limit = device.limits.maxTextureDimension3D
      if (depth * BRICK > limit)
        throw new EngineError(
          'TEXTURE_BUDGET',
          `the mesh distance field atlas needs ${depth * BRICK} texels deep, the device allows ${limit}`,
          {},
        )
      const next = device.createTexture({
        label: 'Trillion3D mesh distance field bricks',
        dimension: '3d',
        size: { width: sizeXY * BRICK, height: sizeXY * BRICK, depthOrArrayLayers: depth * BRICK },
        format: 'r8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      })
      if (texture) carry(texture, next)
      texture = next
    },
    destroy: () => texture?.destroy(),
  }
}

/** A buffer for `source` that replaces `old` (retired), written whole. */
function remade(device: GPUDevice, old: GPUBuffer | undefined, source: Uint32Array, label: string) {
  const next = device.createBuffer({
    label,
    size: source.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  if (old) retire(device, old)
  device.queue.writeBuffer(next, 0, source as Uint32Array<ArrayBuffer>)
  return next
}

/** The table of a mip added written into `table` and `buffer`, its cells now the atlas's brick indices. */
function writeMipTable(
  device: GPUDevice,
  table: Uint32Array,
  buffer: GPUBuffer,
  state: AtlasState,
  { asset, reversed }: AssetMip,
  blockBricks: number,
) {
  const held = state.assets[asset]!.mips[reversed]
  const { indirection } = state.dataOf(mipOf(state.assets[asset]!.field, reversed))
  indirection.forEach((brick, cell) => {
    const block = Math.floor(brick / blockBricks)
    table[held.tableOffset + cell] =
      brick === INVALID_BRICK_INDEX || block >= held.blocks.length
        ? INVALID_BRICK_INDEX
        : (brick % blockBricks) + held.blocks[block] * blockBricks
  })
  device.queue.writeBuffer(
    buffer,
    held.tableOffset * 4,
    table as Uint32Array<ArrayBuffer>,
    held.tableOffset,
    indirection.length,
  )
}

/** The two storage buffers and the host's copy of each. */
function createRecordBuffers(device: GPUDevice) {
  let table = new Uint32Array(4)
  let tableBuffer: GPUBuffer | undefined
  let assets: RecordWords = recordWords(new ArrayBuffer(ASSET_STRIDE * 16))
  let assetBuffer: GPUBuffer | undefined
  return {
    get table() {
      return tableBuffer!
    },
    get assets() {
      return assetBuffer!
    },
    /** Room for `count` assets' records. */
    growAssets(count: number) {
      const words = nextPow2(Math.max(1, count)) * ASSET_STRIDE * 4
      if (assetBuffer && assets.u32.length >= words) return
      const next = recordWords(new ArrayBuffer(words * 4))
      next.u32.set(assets.u32)
      assets = next
      assetBuffer = remade(device, assetBuffer, next.u32, 'Trillion3D mesh distance field assets')
    },
    /** Room for `words` words of tables. */
    growTable(words: number) {
      const size = Math.max(4, nextPow2(words))
      if (tableBuffer && table.length >= size) return
      const next = new Uint32Array(size)
      next.set(table)
      table = next
      tableBuffer = remade(device, tableBuffer, next, 'Trillion3D mesh distance field indirection')
    },
    /** The record of `asset`'s reversed mip, as `state` holds it, written. */
    writeRecord(state: AtlasState, { asset, reversed }: AssetMip) {
      writeAssetRecord(assets, asset, reversed, state.assets[asset])
      const at = (asset * ASSET_STRIDE + reversed * ASSET_MIP_STRIDE) * 4
      device.queue.writeBuffer(
        assetBuffer!,
        at * 4,
        assets.u32 as Uint32Array<ArrayBuffer>,
        at,
        ASSET_MIP_STRIDE * 4,
      )
    },
    /** The table of a mip added, its cells now the atlas's brick indices. */
    writeTable(state: AtlasState, mip: AssetMip, blockBricks: number) {
      writeMipTable(device, table, tableBuffer!, state, mip, blockBricks)
    },
    destroy() {
      tableBuffer?.destroy()
      assetBuffer?.destroy()
    },
  }
}

/** The block of the scene written: the atlas's size in bricks and the objects it serves. */
function writeSceneBlock(
  queue: GPUQueue,
  buffer: GPUBuffer,
  sizeXY: number,
  depth: number,
  objects: number,
) {
  const floats = new Float32Array(SCENE_BLOCK.words)
  const words = new Uint32Array(floats.buffer)
  const at = SCENE_BLOCK.at
  ;[sizeXY, sizeXY, depth].forEach((bricks, k) => {
    const texels = bricks * BRICK
    words[at.atlasMask + k] = bricks - 1
    words[at.atlasLog2 + k] = floorLog2(bricks)
    floats[at.texel + k] = 1 / texels
    floats[at.halfTexel + k] = 0.5 / texels
    floats[at.offsetToUv + k] = BRICK / texels
    floats[at.uniqueInTexels + k] = UNIQUE_BRICK / texels
  })
  words[at.objects] = objects
  queue.writeBuffer(buffer, 0, floats)
}

/** The atlas's resources, for a budget whose first two sides are `sizeXY` bricks. */
export function createAtlasGpu(device: GPUDevice, sizeXY: number) {
  const sceneBuffer = device.createBuffer({
    label: 'Trillion3D mesh distance field scene',
    size: SCENE_BLOCK.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({
    label: 'Trillion3D mesh distance field sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    addressModeW: 'repeat',
  })
  const bricks = createBrickTexture(device, sizeXY)
  const records = createRecordBuffers(device)
  const scratch = new Uint32Array(sizeXY * 128)
  return {
    sceneBuffer,
    sampler,
    records,
    get brickTexture() {
      return bricks.texture
    },
    get brickView() {
      return bricks.texture.createView({ dimension: '3d' })
    },
    /** Brings the resources level with `state` after `step`, and writes what the step added. */
    apply(state: AtlasState, step: AtlasStep, budget: AtlasBudget, objects: number) {
      bricks.ensure(atlasDepth(state.blocks.size * budget.blockBricks, budget))
      records.growAssets(state.assets.length)
      records.growTable(state.spans.extent)
      for (const add of step.added) {
        records.writeTable(state, add, budget.blockBricks)
        const asset = state.assets[add.asset]!
        const mip = mipOf(asset.field, add.reversed)
        writeBricks(
          device.queue,
          bricks.texture,
          state.dataOf(mip).bricks,
          asset.mips[add.reversed],
          budget.blockBricks,
          sizeXY,
          scratch,
        )
        state.forget(mip)
      }
      for (const record of step.records) records.writeRecord(state, record)
      writeSceneBlock(device.queue, sceneBuffer, sizeXY, bricks.depth, objects)
    },
    dispose() {
      bricks.destroy()
      records.destroy()
      sceneBuffer.destroy()
    },
  }
}

/** The atlas's resources (`createAtlasGpu`). */
export type AtlasGpu = ReturnType<typeof createAtlasGpu>
