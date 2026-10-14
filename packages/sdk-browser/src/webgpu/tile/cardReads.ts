import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { atlasBindings, atlasLayoutEntries } from '../core/bindLayout.ts'
import { atlasEntries } from '../core/bindEntries.ts'
import { resourceEntry } from '../core/liveEntries.ts'
import { tileKindWgsl } from './kindWgsl.ts'
import { FEEDBACK_RULE_WGSL, tileRequestAtWgsl } from './requestWgsl.ts'
import { SHADOW_TILE_POOL_WGSL, tileDeclarations } from './wgsl.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'

/** The group the card pass binds the tile pool in: after the image's (view and records). */
const CARD_TILE_GROUP = 1
/** Its bindings: the colour atlas's lanes and table, the data atlas's, then the maps' sampler. */
const COLOR = atlasBindings(0),
  DATA = atlasBindings(4),
  SAMPLER = 8

/**
 * WHAT THE IMPOSTOR CARD PASS READS OF THE TILE POOL (#1527): the colour and data atlases at group
 * 1, the reads of a texture at an explicit level (`colorBlend`, `dataBlend`) on the pool at no
 * level offset — a card reads at its own level, which no frame bias moves, as the hardware read
 * a whole chain at it —, and the request rule every pass that asks tiles shares (`${k}RequestAt`,
 * `FEEDBACK_RULE_WGSL`). The card code receives it lent (`../impostor/lent.ts`): its chunk holds
 * no tile module of its own.
 */
export const cardTileWgsl = () =>
  wgslBlock(
    'cardTileWgsl',
    [
      SHADOW_TILE_POOL_WGSL,
      tileKindWgsl('color', SHADOW_TILE_POOL_WGSL),
      tileKindWgsl('data', SHADOW_TILE_POOL_WGSL),
      tileRequestAtWgsl('color', SHADOW_TILE_POOL_WGSL),
      tileRequestAtWgsl('data', SHADOW_TILE_POOL_WGSL),
      FEEDBACK_RULE_WGSL,
    ],
    `${tileDeclarations(COLOR, 'color', CARD_TILE_GROUP)}
${tileDeclarations(DATA, 'data', CARD_TILE_GROUP)}
@group(${CARD_TILE_GROUP}) @binding(${SAMPLER}) var mapsSampler:sampler;`,
  )

/** The layout entries of the card pass's tile group, for the fragment stage. */
export const cardTileLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  ...atlasLayoutEntries(COLOR, GPUShaderStage.FRAGMENT),
  ...atlasLayoutEntries(DATA, GPUShaderStage.FRAGMENT),
  { binding: SAMPLER, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
]

/** The atlases the card pass's tile group is made over: their lane views and tables. */
export type CardAtlases = { color: WebgpuTileAtlas; data: WebgpuTileAtlas }

/** The entries of the card pass's tile group, read live from `atlases()` and `sampler()` — the
 *  colour atlas's lanes and table, the data atlas's (`atlasEntries`), then the sampler —: made once,
 *  the group made again when what they name moves (`entriesMoved`). */
export const cardTileEntries = (
  atlases: () => CardAtlases,
  sampler: () => GPUSampler,
): GPUBindGroupEntry[] => [
  ...atlasEntries(COLOR, () => atlases().color),
  ...atlasEntries(DATA, () => atlases().data),
  resourceEntry(SAMPLER, sampler),
]
