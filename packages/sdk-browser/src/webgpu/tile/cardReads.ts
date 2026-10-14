import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { atlasBindings, atlasLayoutEntries } from '../core/bindLayout.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
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
type CardAtlases = { color: WebgpuTileAtlas; data: WebgpuTileAtlas }

/** The entries of the card pass's tile group over the atlases as they stand, in the one order
 *  `cardTileResources` writes — its tables bound as buffers. */
export function cardTileEntries(atlases: CardAtlases, sampler: GPUSampler) {
  const held: unknown[] = []
  cardTileResources(held, atlases, sampler)
  const tables = [atlases.color.pages.buffer, atlases.data.pages.buffer]
  return sequentialEntries(
    held.map((resource) =>
      tables.includes(resource as GPUBuffer)
        ? { buffer: resource as GPUBuffer }
        : (resource as GPUBindingResource),
    ),
  )
}

/** What the card pass's tile group binds of `atlases` and `sampler`, written into `next` in binding
 *  order — the identity its group is made again on, and what `cardTileEntries` binds —: no array
 *  made for a group that stays. */
export function cardTileResources(
  next: unknown[],
  { color, data }: CardAtlases,
  sampler: GPUSampler,
) {
  let at = 0
  for (const view of color.views) next[at++] = view
  next[at++] = color.pages.buffer
  for (const view of data.views) next[at++] = view
  next[at++] = data.pages.buffer
  next[at++] = sampler
  next.length = at
}
