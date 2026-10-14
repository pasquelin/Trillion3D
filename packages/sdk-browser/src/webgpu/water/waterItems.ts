import { readHostBox } from '../../host/world/bounds.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import { waterRankOf } from '../transparent/transmission.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import type { WebgpuBlendState } from '../blend/state.ts'

/**
 * WHAT THE WATER RECTANGLE KNOWS OF A TRANSMISSIVE ITEM, by water rank (`rectWgsl.ts`): the six
 * doubles of its geometry's local box — grown by its deformation's reach when deformed
 * (`deformLocal`), what its deformed vertices stay in —, then whether its rectangle may crop the
 * pass at all — a local box known, its own triangles (a paged surface keeps full coverage), no
 * line or sprite surface. Its item rank is its volume's (`VOLUME_ITEM`), its world box and pose
 * the key record's and the item record's, read where they are.
 */
export const WATER_ITEM_WORDS = 14
const WATER_ITEM = { crops: 12 } as const

/** The record's layout as the rectangle kernel names it. */
export const WATER_ITEM_WGSL = wgslBlock(
  'WATER_ITEM_WGSL',
  [],
  wgslConsts({
    WATER_ITEM_WORDS,
    WATER_ITEM_CROPS: WATER_ITEM.crops,
  }),
)

/** Every transmissive item's record, written with the key records: what it reads moves with the
 *  plan — a geometry, a surface's line or sprite, the item list. */
export function writeWaterItems(blendState: WebgpuBlendState) {
  const count = blendState.transmissive,
    doubles = (count * WATER_ITEM_WORDS) / 2
  if (blendState.waterItemPacked.length < doubles) {
    blendState.waterItemPacked = new Float64Array(doubles)
    blendState.waterItemWords = new Uint32Array(blendState.waterItemPacked.buffer)
  }
  blendState.waterItemsMoved = false
  const packed = blendState.waterItemPacked,
    words = blendState.waterItemWords
  for (const item of blendState.blendGpu) {
    const rank = waterRankOf(item.flags)
    if (!rank || rank > count) continue
    const at = (rank - 1) * WATER_ITEM_WORDS,
      local = item.sourceGeometry?.boundingBox
    if (item.deformLocal) packed.set(item.deformLocal, at / 2)
    else if (local) readHostBox(local, packed, at / 2)
    else packed.fill(0, at / 2, at / 2 + 6)
    const own = !(item.flags & FLAG_CLUSTER_PAGE) && !item.surface.lineWidth && !item.surface.sprite
    words[at + WATER_ITEM.crops] = local && own ? 1 : 0
  }
  return words.subarray(0, count * WATER_ITEM_WORDS)
}
