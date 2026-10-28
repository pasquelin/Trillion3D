import {
  expandTile,
  PIXEL_FORMATS,
  TILE_RES,
  TILE_RES_PADDED,
  type SparseVolumeFrame,
} from './sparseVolumeFile.ts'
import { atlasResolutionInTiles, atlasCell, fallbackVoxel } from './sparseVolumeAtlas.ts'

/**
 * A SPARSE VOLUME FRAME ON THE GPU: its page table as a 3D texture of one word a page with a mip
 * level per level of the frame, and its tiles in 3D atlases, one per attribute texture, each tile a
 * cube of `TILE_RES_PADDED` voxels, the tile at atlas cell `(0, 0, 0)` being the null tile that
 * holds the fallback value. A page-table word holds the atlas cell of its tile in three bytes
 * (`x | y << 8 | z << 16`) and the mip level the tile belongs to above them (`level << 24`); a page
 * without a tile is zero, the null tile. Every tile is resident (the frame is not streamed).
 */

/**
 * The uniforms of a frame in the two words of four that `svtUnpack` reads: the volume's size in
 * pages (floats), the lowest page of its page table packed 11, 11 and 10 bits; the atlas's texel
 * (floats), the frame's rank and the coarsest level below the count (`FTextureRenderResources::
 * GetPackedUniforms`, `SparseVolumeTexture.cpp:870-891`). `volumeResolution` is the voxels of the
 * volume as a whole (every frame of an animation), `atlasSize` the atlas's size in voxels.
 */
export function packedUniforms(
  frame: SparseVolumeFrame,
  frameIndex: number,
  volumeResolution: readonly [number, number, number],
  atlasSize: readonly [number, number, number],
): Uint32Array {
  const words = new Uint32Array(8)
  const floats = new Float32Array(words.buffer)
  floats.set(
    volumeResolution.map((side) => side / TILE_RES),
    0,
  )
  const [x, y, z] = frame.pageTableMin
  words[3] = ((x & 0x7ff) | ((y & 0x7ff) << 11) | ((z & 0x3ff) << 22)) >>> 0
  floats.set(
    atlasSize.map((side) => 1 / side),
    4,
  )
  words[7] = ((frameIndex & 0xffff) | (((frame.mipCount - 1) & 0xffff) << 16)) >>> 0
  return words
}

/** The resources of one frame. */
export interface SparseVolumeFrameGpu {
  readonly pageTable: GPUTexture
  /** The tile atlas of each attribute texture, none where its format is none. */
  readonly tiles: readonly [GPUTexture | undefined, GPUTexture | undefined]
  /** The atlas's size in tiles. */
  readonly atlasTiles: readonly [number, number, number]
  destroy(): void
}

type Xyz = [number, number, number]

/** The page table texture of `frame`, its mips made, nothing written. */
function createPageTable(device: GPUDevice, frame: SparseVolumeFrame, label: string) {
  const res = frame.pageTableResolution
  return device.createTexture({
    label: `${label} page table`,
    dimension: '3d',
    size: [Math.max(1, res[0]), Math.max(1, res[1]), Math.max(1, res[2])],
    mipLevelCount: frame.mipCount,
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
}

/** The tile atlas of each attribute texture of `frame` over `atlasTiles` cells, none where its format is none. */
function createAtlases(
  device: GPUDevice,
  frame: SparseVolumeFrame,
  label: string,
  atlasTiles: Xyz,
) {
  const atlasSize = atlasTiles.map((cells) => cells * TILE_RES_PADDED) as Xyz
  return ([0, 1] as const).map((attribute) => {
    const format = PIXEL_FORMATS[frame.formats[attribute]]
    if (!format.gpu) return undefined
    return device.createTexture({
      label: `${label} tiles ${attribute === 0 ? 'A' : 'B'}`,
      dimension: '3d',
      size: atlasSize,
      format: format.gpu,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
  }) as [GPUTexture | undefined, GPUTexture | undefined]
}

/** Writes the null tile, then every tile of `frame` after it, into the atlases. */
function writeTiles(
  device: GPUDevice,
  frame: SparseVolumeFrame,
  atlas: readonly (GPUTexture | undefined)[],
  atlasTiles: Xyz,
) {
  const nulls = ([0, 1] as const).map((attribute) =>
    fallbackVoxel(frame.formats[attribute], frame.fallback[attribute]),
  )
  const putTile = (attribute: 0 | 1, rank: number, bytes: Uint8Array) => {
    const texture = atlas[attribute]
    if (!texture) return
    const size = PIXEL_FORMATS[frame.formats[attribute]].bytes
    const cell = atlasCell(rank, atlasTiles)
    device.queue.writeTexture(
      { texture, origin: cell.map((c) => c * TILE_RES_PADDED) as Xyz },
      bytes as BufferSource,
      { bytesPerRow: TILE_RES_PADDED * size, rowsPerImage: TILE_RES_PADDED },
      [TILE_RES_PADDED, TILE_RES_PADDED, TILE_RES_PADDED],
    )
  }
  for (const attribute of [0, 1] as const)
    putTile(attribute, 0, repeat(nulls[attribute], TILE_RES_PADDED ** 3))
  for (let tile = 0; tile < frame.tileCount; tile++)
    for (const attribute of [0, 1] as const)
      if (atlas[attribute])
        putTile(attribute, tile + 1, expandTile(frame, tile, attribute, nulls[attribute]))
}

/** Writes the page table level by level: a page's word names its tile's atlas cell and the level the tile is of. */
function writePageTable(
  device: GPUDevice,
  frame: SparseVolumeFrame,
  pageTable: GPUTexture,
  atlasTiles: Xyz,
) {
  const res = frame.pageTableResolution
  const sizeOf = (level: number) => res.map((side) => Math.max(1, side >> level)) as Xyz
  for (let level = 0; level < frame.mipCount; level++) {
    const [w, h, d] = sizeOf(level)
    const texels = new Uint32Array(w * h * d)
    const [offset, count] = [frame.mipPages[level * 2], frame.mipPages[level * 2 + 1]]
    for (let page = offset; page < offset + count; page++) {
      const packed = frame.coords[page]
      const [x, y, z] = [packed & 0x7ff, (packed >>> 11) & 0x7ff, packed >>> 22]
      const [cx, cy, cz] = atlasCell(frame.tileIndices[page] + 1, atlasTiles)
      texels[(z * h + y) * w + x] = (cx | (cy << 8) | (cz << 16) | (level << 24)) >>> 0
    }
    device.queue.writeTexture(
      { texture: pageTable, mipLevel: level },
      texels as BufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h, d],
    )
  }
}

/** Uploads `frame`: its page table level by level and each of its tiles into its atlas cell. */
export function uploadSparseVolumeFrame(
  device: GPUDevice,
  frame: SparseVolumeFrame,
  label: string,
): SparseVolumeFrameGpu {
  const pageTable = createPageTable(device, frame, label)
  const atlasTiles = atlasResolutionInTiles(frame.tileCount + 1)
  const atlas = createAtlases(device, frame, label, atlasTiles)
  writeTiles(device, frame, atlas, atlasTiles)
  writePageTable(device, frame, pageTable, atlasTiles)
  return {
    pageTable,
    tiles: atlas,
    atlasTiles,
    destroy() {
      pageTable.destroy()
      atlas.forEach((texture) => texture?.destroy())
    },
  }
}

function repeat(voxel: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(voxel.length * count)
  for (let at = 0; at < out.length; at += voxel.length) out.set(voxel, at)
  return out
}
