import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { samplingWords } from '../texture/sampling.ts'
import { wrapNibble } from '../../visibility/wrapModes.ts'
import {
  SIBLING_CAP,
  SIBLING_DATA,
  SIBLING_SLOT_MASK,
  siblingRef,
  siblingWord,
} from './page/pageTable.ts'
import type { TileTexture } from './tileTexture.ts'

/**
 * THE STACKS OF A MATERIAL: the maps it reads at the same coordinates — the same UV set, the same
 * transform, the same addressing and the same aspect — are one stack, as the reference groups the
 * layers of a material (a stack is its coordinate, mip value, page table, addressing and aspect: not
 * its filter, which each layer's sampler keeps). A pixel that reads one of them reads the others' tiles
 * at the same place of the image, whatever their sizes: the reference aligns the layers of a stack by a
 * mip bias, the log2 of the ratio of the sizes (`sizeBias`). The page table lists the siblings of each
 * texture (`page/pageTable.ts`); the stamp reads them (`../stampWgsl.ts`).
 */

/** A map of a material: its texture, the atlas it lies in and its slot there. */
export type StackedMap = { texture: Texture; kind: 'color' | 'data'; slot: number }

/** The siblings of each texture by atlas and slot, as references (`stackRef`), before sizes are known. */
export type SiblingSets = Record<'color' | 'data', Set<number>[]>

/** What a map is read by, but for its aspect (`siblingWords`, which knows its size). */
function stackKey(texture: Texture) {
  const words = samplingWords(texture)
  return `${texture.channel ?? 0}|${wrapNibble(texture)}|${words.slice(1).join(',')}`
}

/** The log2 of the ratio of a texture's size to a sibling's, as the reference takes it: the smaller of
 *  the two sides' rounded-up, negative when the sibling is the larger. */
export function sizeBias(
  width: number,
  height: number,
  siblingWidth: number,
  siblingHeight: number,
) {
  const side = (own: number, other: number) =>
    own >= other ? Math.ceil(Math.log2(own / other)) : -Math.ceil(Math.log2(other / own))
  return Math.min(side(width, siblingWidth), side(height, siblingHeight))
}

/** Lists in `into`, for each map of one material, the other maps of its stack. */
export function noteStacks(into: SiblingSets, maps: readonly StackedMap[]) {
  const stacks = new Map<string, StackedMap[]>()
  for (const map of maps) {
    const key = stackKey(map.texture),
      stack = stacks.get(key)
    if (stack) stack.push(map)
    else stacks.set(key, [map])
  }
  for (const stack of stacks.values())
    for (const map of stack) {
      const own = (into[map.kind][map.slot] ??= new Set())
      for (const other of stack)
        if (other.kind !== map.kind || other.slot !== map.slot)
          own.add(siblingRef(other.kind, other.slot))
    }
}

/**
 * The words a texture lists for the references of its stack (`refs`, from `noteStacks`): those of its
 * aspect — the reference keeps the aspect in a stack's key —, each with the bias of the sizes
 * (`sizeBias`), at most `SIBLING_CAP` of them.
 */
export function siblingWords(
  atlases: Record<'color' | 'data', readonly TileTexture[]>,
  texture: TileTexture,
  refs: Iterable<number> = [],
) {
  const { width, height } = texture.layout
  const words: number[] = []
  for (const ref of refs) {
    const other = atlases[ref & SIBLING_DATA ? 'data' : 'color'][ref & SIBLING_SLOT_MASK]?.layout
    if (other && other.width * height === other.height * width)
      words.push(siblingWord(ref, sizeBias(width, height, other.width, other.height)))
  }
  return words.slice(0, SIBLING_CAP)
}
