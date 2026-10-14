import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/index.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { tileKeyOf } from './ids.ts'
import type { WebgpuTilePool } from './pool.ts'

/** Words before the places: each lane's first place, `PREVIEW_LAYOUT_NAMES` order, padded to
 *  four, then the places of all lanes. */
export const TILE_USE_HEADER = alignUp(PREVIEW_LAYOUT_NAMES.length, 4)
/** The tier of a free or pinned place: never ranked, never a victim. */
export const TILE_UNRANKED = 0xffffffff
/** Words of one place: the clock a pixel last read it, and its tier. */
const PLACE_USE_WORDS = 2

/** \`tilePlaceWord(base, index)\`: the first word of place \`index\` of the lane whose places start
 *  at \`base\` — its clock, its tier the next —, as every kernel reading the words finds it. */
export const TILE_PLACE_WORD_WGSL = wgslFn(
  'tilePlaceWord',
  [],
  `fn tilePlaceWord(base:u32,index:u32)->u32{return ${TILE_USE_HEADER}u+${PLACE_USE_WORDS}u*(base+index);}`,
)

/** The buffer of an atlas's place words over `places` places: what `layout` creates, and what a
 *  probe asks the device for beside the pools' textures (`../residency/poolGrants.ts`). */
export const tileUseBuffer = (kind: 'color' | 'data', places: number) => ({
  label: `Trillion3D texture place use ${kind}`,
  size: (TILE_USE_HEADER + PLACE_USE_WORDS * Math.max(1, places)) * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
})

/**
 * The GPU words of an atlas's places (#1527): per place of each lane's pool, the last clock a pixel
 * read it — `atomicMax` by the feedback reduction, on the place the page-table entry a pixel asked
 * names, the ancestor standing in for a missing tile included (`stampWgsl.ts`) — and its tier: the
 * level its tile carries, `TILE_UNRANKED` free or pinned. The pool's queue ranks them
 * (`evictSortWgsl.ts`).
 *
 * The CPU writes only the places a pool occupied, pinned, unpinned or freed (`changed`): an arrival
 * — or a tile an asker stops holding (`WebgpuTilePool.pin`, an impostor card's maps) — is used at
 * the clock it lands on, in use for the frames after it; a freed or pinned place is unranked.
 * Every other stamp is the GPU's. A lane pool replaced moves every base:
 * the buffer is made again, every occupied place written as an arrival.
 */
export function createTileSlotUse(device: GPUDevice, kind: 'color' | 'data') {
  let buffer: GPUBuffer | undefined
  let pools: readonly (WebgpuTilePool | undefined)[] = []
  const bases = new Uint32Array(TILE_USE_HEADER)
  let scratch = new Uint32Array(0)
  /** Writes places `first` to `last` of `pool`, lane base `base`, at `clock`. */
  const write = (
    pool: WebgpuTilePool,
    base: number,
    first: number,
    last: number,
    clock: number,
  ) => {
    const count = last - first + 1
    scratch = resized(scratch, PLACE_USE_WORDS * count)
    for (let i = 0; i < count; i++) {
      const index = first + i,
        held = !pool.freeAt(index) && !pool.pinnedOf(index)
      scratch[PLACE_USE_WORDS * i] = held ? clock : 0
      scratch[PLACE_USE_WORDS * i + 1] = held ? tileKeyOf(pool.keyOf(index)).level : TILE_UNRANKED
    }
    device.queue.writeBuffer(
      buffer!,
      (TILE_USE_HEADER + PLACE_USE_WORDS * (base + first)) * 4,
      scratch,
      0,
      PLACE_USE_WORDS * count,
    )
  }
  return {
    /** The words the reduction stamps and the sort ranks. */
    get buffer() {
      return buffer!
    },
    /** Each lane's pool, `PREVIEW_LAYOUT_NAMES` order, none where a lane has no pool. */
    get pools() {
      return pools
    },
    /** First place of lane `lane` in the words. */
    base: (lane: number) => bases[lane],
    /** The lanes' pools, `PREVIEW_LAYOUT_NAMES` order, none where a lane has no pool: a new
     *  buffer at their places, the old one retired, every occupied place marked for `flush`. */
    layout(next: readonly (WebgpuTilePool | undefined)[]) {
      pools = next
      let places = 0
      PREVIEW_LAYOUT_NAMES.forEach((_, lane) => {
        bases[lane] = places
        places += next[lane]?.tiles ?? 0
      })
      if (buffer) retire(device, buffer)
      buffer = device.createBuffer(tileUseBuffer(kind, places))
      device.queue.writeBuffer(buffer, 0, bases)
      for (const pool of next)
        if (pool) for (const index of pool.occupied()) pool.changed.mark(index)
    },
    /** Sends the places each pool changed, arrivals used at `clock`. */
    flush(clock: number) {
      pools.forEach((pool, lane) => {
        if (!pool?.changed.count) return
        const { count, pairs } = pool.changed.runs()
        for (let r = 0; r < count; r++)
          write(pool, bases[lane], pairs[2 * r], pairs[2 * r + 1], clock)
        pool.changed.clear()
      })
    },
    destroy() {
      buffer?.destroy()
    },
  }
}

export type TileSlotUse = ReturnType<typeof createTileSlotUse>
