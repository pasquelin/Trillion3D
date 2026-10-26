import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createSpanAllocator } from '../../../../math/src/sequence/spanAllocator.ts'
import type {
  DistanceFieldMip,
  DistanceFieldMipData,
  MeshDistanceField,
} from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { createBlockAllocator } from './allocators.ts'
import { BRICK_VOXELS } from './layout.ts'

/**
 * WHICH MIPS OF WHICH MESHES THE BRICK ATLAS HOLDS, and where. The coarsest mip of a mesh is loaded
 * as soon as a placement uses the mesh and stays while one does; the finer ones are asked for by the
 * GPU (`streamingWgsl.ts`: for each mesh the number of mips its nearest placement wants, from how
 * close that placement is to the camera), and loaded or dropped here, a frame later, within the
 * atlas's room and the frame's upload budget (`atlasRequests.ts`). A mip is a run of words in the
 * indirection tables and a list of blocks of the atlas; a mesh's mips are numbered coarsest first —
 * the reversed order — because the programs read them so and a mesh never holds a finer mip
 * without the coarser.
 */

/** What the streaming is allowed (the `meshDistanceField` settings). */
export interface AtlasBudget {
  /** Bricks along the first two axes of the atlas. */
  readonly sizeXY: number
  /** Bricks along the third axis past which the finer mips are dropped. */
  readonly maxDepth: number
  /** Bricks to an allocation. */
  readonly blockBricks: number
  /** Bytes of bricks uploaded a frame. */
  readonly uploadBytes: number
  /** Whether the mips added in a frame are allocated last first. */
  readonly reverseOrder: boolean
}

/** A mip loaded: where its table is and which blocks hold its bricks. */
export interface MipState {
  readonly dims: readonly [number, number, number]
  readonly tableOffset: number
  readonly bricks: number
  readonly blocks: readonly number[]
}

/** A mesh with a field the scene holds. */
export interface AssetState {
  readonly field: MeshDistanceField
  refCount: number
  /** The mips the GPU last asked for. */
  wanted: number
  /** Coarsest first. */
  readonly mips: MipState[]
}

/** A mip asked to be loaded, which the next frame loads. */
export interface ReadRequest {
  readonly asset: number
  readonly reversed: number
  readonly field: MeshDistanceField
}

/** One mip of one asset: a record of the asset buffer, or the data of a mip to upload. */
export interface AssetMip {
  readonly asset: number
  readonly reversed: number
}

/** The reversed mip of a mesh: the file holds the finest first. */
export const mipOf = (field: MeshDistanceField, reversed: number): DistanceFieldMip =>
  field.mips[field.mips.length - 1 - reversed]

/** The bytes of the bricks of a mip. */
export const brickBytes = (mip: DistanceFieldMip) => mip.brickCount * BRICK_VOXELS

/** The indirection cells of a mip. */
const tableCells = (mip: DistanceFieldMip) =>
  mip.indirectionSize[0] * mip.indirectionSize[1] * mip.indirectionSize[2]

/** The atlas's state: its assets, the requests in flight, the space taken. */
export function createAtlasState() {
  const assets: (AssetState | undefined)[] = []
  const free: number[] = []
  const byField = new Map<MeshDistanceField, number>()
  // The tables and bricks of the mips read by parts (`DistanceFieldMip.read`), from their reading
  // to their upload: the atlas holds a mip's bytes only that long.
  const data = new Map<DistanceFieldMip, DistanceFieldMipData>()
  const reading = new Set<DistanceFieldMip>()
  return {
    assets,
    byField,
    /** The first reading that failed, which the next step throws. */
    failure: undefined as unknown,
    /** Whether the table and bricks of `mip` are held: always for a mip of a file read whole. */
    ready: (mip: DistanceFieldMip) => !mip.read || data.has(mip),
    /** Starts reading `mip` if it is neither held nor being read. */
    fetch(mip: DistanceFieldMip) {
      if (this.ready(mip) || !mip.read || reading.has(mip)) return
      reading.add(mip)
      mip.read().then(
        (read) => {
          if (reading.delete(mip)) data.set(mip, read)
        },
        (error: unknown) => {
          this.failure ??= error
        },
      )
    },
    /** The table and bricks of a mip that is `ready`. */
    dataOf: (mip: DistanceFieldMip): DistanceFieldMipData => data.get(mip) ?? mip,
    /** Lets go of the bytes of a mip read by parts, once uploaded. */
    forget: (mip: DistanceFieldMip) => void data.delete(mip),
    spans: createSpanAllocator(true),
    blocks: createBlockAllocator(),
    /** The mips asked for and not loaded yet. */
    requests: [] as ReadRequest[],
    /** The assets made since the last step, which take their coarsest mip. */
    added: new Set<number>(),
    /** The assets a placement stopped using since the last step. */
    removed: new Set<number>(),
    /** The asset of `field` — a compiled mesh's or an HLOD cell's actors' —, made at its first
     *  placement; one placement more uses it. */
    reference(field: MeshDistanceField) {
      let id = byField.get(field)
      if (id === undefined) {
        id = free.pop() ?? assets.length
        assets[id] = { field, refCount: 0, wanted: 1, mips: [] }
        byField.set(field, id)
        this.added.add(id)
      }
      assets[id]!.refCount++
      return id
    },
    /** One placement fewer uses the asset; with none it is freed at the next step. */
    release(id: number) {
      const asset = assets[id]
      if (asset && --asset.refCount <= 0) this.removed.add(id)
    },
    /** Frees asset `id` and its room: its id may be given to another field. */
    drop(id: number) {
      const asset = assets[id]!
      asset.mips.forEach((mip) => this.freeMip(mip))
      for (const mip of asset.field.mips) {
        reading.delete(mip)
        data.delete(mip)
      }
      byField.delete(asset.field)
      assets[id] = undefined
      free.push(id)
    },
    /** Gives a mip's room back. */
    freeMip(mip: MipState) {
      this.spans.release(mip.tableOffset, mip.dims[0] * mip.dims[1] * mip.dims[2])
      if (mip.bricks > 0) this.blocks.release(mip.blocks)
    },
    /** Gives a mip its room, as the next one of its asset. */
    allocate({ asset, reversed }: AssetMip, blockBricks: number) {
      const state = assets[asset]!
      const mip = mipOf(state.field, reversed)
      state.mips.push({
        dims: mip.indirectionSize,
        tableOffset: this.spans.allocate(tableCells(mip)),
        bricks: mip.brickCount,
        blocks: this.blocks.allocate(ceilDiv(mip.brickCount, blockBricks)),
      })
    },
  }
}

export type AtlasState = ReturnType<typeof createAtlasState>
