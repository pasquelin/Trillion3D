import { DRAW_ITEM_U32 } from '../../../packages/sdk-browser/src/gpu/draw/contract.ts'
import {
  evaluateDrawCompact,
  indirectForDraw,
  type DrawItem,
} from '../../../packages/sdk-browser/src/gpu/draw/cpu.fixture.ts'
import { hasBit } from '../../../packages/math/src/scalar/bits.ts'
import { boundWords, type BoundBuffer } from './fakeBuffers.ts'
import { maskBit } from './globals.ts'

/** Replays the draw compaction (`scatterGroups`) over the group it binds: the items, the uniform,
 *  the rest bits and, when bound, the visibility mask; the counts, instances and indirect
 *  arguments written where the draw reads them. */
export function simulateScatterGroups(entries: readonly BoundBuffer[]) {
  const uni = boundWords(entries, 1)
  const count = uni[0],
    maxVertexCount = uni[1],
    slotCap = uni[2]
  const itemInts = boundWords(entries, 0)
  const n = Math.min(count, slotCap)
  const restInts = boundWords(entries, 7)
  const restAt = (i: number) => (hasBit(restInts, i) ? 1 : 0)
  const items: DrawItem[] = []
  for (let i = 0; i < n; i++)
    items.push({
      pageIndex: itemInts[i * DRAW_ITEM_U32],
      bin: itemInts[i * DRAW_ITEM_U32 + 1],
      rest: restAt(i),
    })
  const source =
    count > slotCap
      ? items.concat(
          Array.from({ length: count - n }, () => ({
            pageIndex: 0,
            bin: 0 as const,
            rest: 0 as const,
          })),
        )
      : items
  const mask = entries.some((entry) => entry.binding === 6) ? boundWords(entries, 6) : undefined
  const filtered =
    uni[4] && mask
      ? source.filter((_, i) => maskBit(mask, uni[5], itemInts[i * DRAW_ITEM_U32 + 2]))
      : source
  const result = evaluateDrawCompact(count > slotCap ? source : filtered, maxVertexCount, slotCap)
  boundWords(entries, 5).set(result.counts.map((_, slot) => result.indirect[slot * 4 + 3]))
  boundWords(entries, 2).set(result.instances)
  boundWords(entries, 3).set(indirectForDraw(result))
}
