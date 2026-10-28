import type { BoundBuffer } from './fakeBuffers.ts'
import { fakeTileSort } from './fakeTileEvict.ts'
import { TILE_SORT_WGSL } from '../../../packages/sdk-browser/src/materials/virtual/evictSortWgsl.ts'

type PoolSortReplay = (entries: readonly BoundBuffer[], offsets?: readonly number[]) => void

/** The pool sorts the double replays, by the program their pipeline runs: the tile pools'
 *  (`materials/virtual/evictSort.ts`). */
const POOL_SORT_REPLAYS = new Map<string, PoolSortReplay>([[TILE_SORT_WGSL, fakeTileSort]])

/** The replay of the pool sort a module of `code` runs: the tile pools' (their program whole). */
export const poolSortReplayOf = (code: string) => POOL_SORT_REPLAYS.get(code)
