import { DRAW_ITEM_U32 } from '../../../packages/sdk-browser/src/visibility/draw/contract.ts'
import {
  evaluateDrawCompact,
  indirectForDraw,
  type DrawItem,
} from '../../../packages/sdk-browser/src/visibility/draw/cpu.fixture.ts'
import { boundResource, boundWords, type BoundBuffer } from './fakeBuffers.ts'
import { maskBit } from './globals.ts'

/** The main half's items of the image, by the instance buffer its compaction writes: the post
 *  half's run lays its instances after them, as the GPU's prefix starts where the main half's end. */
const mainItems = new WeakMap<object, DrawItem[]>()

/** Replays the draw compaction (`scatterGroups`) of the main half, or of the post half (`post`),
 *  over the group it binds: the items, the half's uniform and, when bound, the cut's mask it
 *  selects by; each slot's start in the offsets region of `groups` (group 0's, `drawGroupWords`),
 *  the instances and indirect arguments written where the draw reads them — both halves' after the
 *  post half's run. */
export function simulateScatterGroups(entries: readonly BoundBuffer[], post: boolean) {
  const uni = boundWords(entries, 1)
  const count = uni[0],
    maxVertexCount = uni[1],
    slotCap = uni[2]
  const itemInts = boundWords(entries, 0)
  const n = Math.min(count, slotCap)
  const rest = post ? 1 : 0
  const items: DrawItem[] = []
  for (let i = 0; i < n; i++)
    items.push({
      pageIndex: itemInts[i * DRAW_ITEM_U32],
      bin: itemInts[i * DRAW_ITEM_U32 + 1],
      rest,
    })
  const source =
    count > slotCap
      ? items.concat(
          Array.from({ length: count - n }, () => ({ pageIndex: 0, bin: 0 as const, rest })),
        )
      : items
  const mask = entries.some((entry) => entry.binding === 5) ? boundWords(entries, 5) : undefined
  const filtered =
    uni[4] && mask
      ? source.filter((_, i) => maskBit(mask, uni[5], itemInts[i * DRAW_ITEM_U32 + 2]))
      : source
  const half = count > slotCap ? source : filtered
  const instances = boundResource(entries, 2).buffer
  if (!post) mainItems.set(instances, half)
  const drawn = post ? [...(mainItems.get(instances) ?? []), ...half] : half
  const result = evaluateDrawCompact(drawn, maxVertexCount, slotCap)
  boundWords(entries, 4).set(result.counts.map((_, slot) => result.indirect[slot * 4 + 3]))
  boundWords(entries, 2).set(result.instances)
  boundWords(entries, 3).set(indirectForDraw(result))
}
