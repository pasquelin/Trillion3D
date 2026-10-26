import type { BoundBuffer } from './fakeBuffers.ts'
import { fakeTileSort } from './fakeTileEvict.ts'
import { TILE_SORT_WGSL } from '../../../packages/sdk-browser/src/materials/virtual/evictSortWgsl.ts'
import { VSM_POOL_SORT_WGSL } from '../../../packages/sdk-browser/src/lighting/shadows/vsm/freePagesWgsl.ts'

type PoolSortReplay = (entries: readonly BoundBuffer[], offsets?: readonly number[]) => void

/**
 * The sorts the double names and replays as nothing, never a sort it does not know: no queue is
 * written. The shadow pool's queue (`vsm/freePagesWgsl.ts`), on its own group: the double runs none
 * of the shadow kernels that pop it (`pmPop`), so nothing it would write is read.
 */
const notReplayed: PoolSortReplay = () => {}

/** The pool sorts the double replays, by the program their pipeline runs: the tile pools'
 *  (`materials/virtual/evictSort.ts`). */
const POOL_SORT_REPLAYS = new Map<string, PoolSortReplay>([[TILE_SORT_WGSL, fakeTileSort]])

/** The replay of the pool sort a module of `code` runs: the tile pools' (their program whole), the
 *  shadow pool's (a program its layout writes, holding the shadow pool's sort). */
export const poolSortReplayOf = (code: string) =>
  POOL_SORT_REPLAYS.get(code) ?? (code.includes(VSM_POOL_SORT_WGSL.text) ? notReplayed : undefined)
