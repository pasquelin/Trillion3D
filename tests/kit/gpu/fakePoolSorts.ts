import type { BoundBuffer } from './fakeBuffers.ts'
import { fakeTileSort } from './fakeTileEvict.ts'
import { TILE_SORT_WGSL } from '../../../packages/sdk-browser/src/webgpu/tile/evictSortWgsl.ts'
import { ROW_SORT_WGSL } from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSortWgsl.ts'
import { VSM_POOL_SORT_WGSL } from '../../../packages/sdk-browser/src/vsm/freePagesWgsl.ts'

type PoolSortReplay = (entries: readonly BoundBuffer[], offsets?: readonly number[]) => void

/**
 * The sorts the double names and replays as nothing, never a sort it does not know: no queue is
 * written. The rows' queue (`webgpu/row/rowEvictSort.ts`), on its own group, ranks the rows on the
 * use words the cut's closure stamps (`rowClosureWgsl.ts`), which the double does not run — the
 * closure reads the cut's whole group, its candidates, live list and draw mask, the double's
 * dispatch sees its last group alone —: a sort on the words the host wrote would hand out rows the
 * cut uses; the host's order stays closed, as no readout brought one. The shadow pool's queue
 * (`vsm/freePagesWgsl.ts`), on its own group: the double runs none of the shadow kernels that pop
 * it (`pmPop`), so nothing it would write is read.
 */
const notReplayed: PoolSortReplay = () => {}

/** The pool sorts the double replays apart from the selection's, by the program their pipeline
 *  runs: the tile pools' (`webgpu/tile/evictSort.ts`), and the rows' by name (`notReplayed`). */
const POOL_SORT_REPLAYS = new Map<string, PoolSortReplay>([
  [TILE_SORT_WGSL, fakeTileSort],
  [ROW_SORT_WGSL, notReplayed],
])

/** The replay of the pool sort a module of `code` runs: the tile pools', the rows' (their programs
 *  whole), the shadow pool's (a program its layout writes, holding the shadow pool's sort). */
export const poolSortReplayOf = (code: string) =>
  POOL_SORT_REPLAYS.get(code) ?? (code.includes(VSM_POOL_SORT_WGSL.text) ? notReplayed : undefined)
