import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import type { TileKey } from './pageTable.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createFileTails } from './fileTails.ts'
import { FEEDBACK_EVERY } from './feedback.ts'

/** A mesh's three maps as textures of the tile atlases (`cardMaps.ts`): the colour and coverage's
 *  slot in the colour atlas, the normal and depth's and the packed ORM's in the data atlas. */
export type CardTiles = readonly [colour: number, normalDepth: number, orm: number]

/** What a mesh's cards read of its maps an image (`planImpostorCards`): the levels from `from` —
 *  the nearest card's — to `to` — one past the farthest card's, the level its blend mixes in —, and
 *  the pixels its nearest card may cover. */
export type CardAsk = { from: number; to: number; pixels: number }

/** What the streamer is told of the impostor maps: each catalogued mesh's three map slots
 *  (`cardMaps.ts`), none in a session without cards, and who hears a card that waits for them
 *  brought something — its plan runs again. */
export type CardOptions = { cards?: ReadonlyMap<number, CardTiles>; onCardsLanded?: () => void }

const NO_CARDS: ReadonlyMap<number, CardTiles> = new Map()

/**
 * THE IMPOSTOR MAPS' RESIDENCY, in the one tile pool: each baked mesh's three maps are textures of
 * the atlases (`cardMaps.ts`) — colour and coverage in the colour atlas, normal and depth and the
 * packed ORM in the data atlas —, held, evicted and budgeted as every texture is. A card is drawn
 * only once every tile of the levels its cards read — from the finest to one past the coarsest
 * (`CardAsk`) — resides in all three maps and their tails are pinned: it then reads what the
 * hardware read of a whole chain, never a coarser stand-in, and until then its mesh keeps its
 * clusters (no image lost). A card not drawn posts no feedback: what it waits for, the CPU asks
 * (`requests.ts`, `fileTails.ts`), weighted by the pixels its nearest card covers as the feedback
 * would count them, one in `FEEDBACK_EVERY`. Every tile it needs that resides, the CPU stamps as
 * it asks (`stamp`), in the use words the pixels' stamp writes (`stampWgsl.ts`): a level its cards
 * need and no pixel reads — the card waiting, or drawn at levels it does not all read — is never a
 * victim, so a full pool cannot turn a card back to its clusters and again.
 *
 * A card asks as the view reaches it: the CPU reacts to a change, never waits on the GPU. A level
 * landing or a tile served while a card waits breaks a held image (`landed`), so the card is
 * planned again. The tails are read through the sources' held levels and written on the device's
 * queue in `encoding`'s lossless lane (`fileTails.ts`).
 */
export function createCardTiles(
  streamer: {
    device: Pick<GPUDevice, 'queue'>
    encoding: PoolEncoding
    sources: { levels: HeldLevels | undefined; failed: LevelFailed }
    color: WebgpuTileAtlas
    data: WebgpuTileAtlas
    requests: { ask: (atlas: WebgpuTileAtlas, key: TileKey, weight: number) => void }
  },
  { cards: slots = NO_CARDS, onCardsLanded: landed = () => {} }: CardOptions,
) {
  const { color, data, encoding } = streamer,
    { levels, failed } = streamer.sources,
    { ask } = streamer.requests
  const tails = createFileTails({ queue: streamer.device.queue, levels, encoding, failed })
  const key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }
  /** A card found waiting since the last pass; one the last pass found. */
  let asked = false,
    waiting = false
  /** Whether every tile of `slot` from level `from` to `to` resides and its tail is pinned; each
   *  one missing asked at `weight`, none stopping the asks of the others. */
  const mapReady = (
    atlas: WebgpuTileAtlas,
    slot: number,
    from: number,
    to: number,
    weight: number,
  ) => {
    const { layout } = atlas.textures[slot]
    let ready = tails.pinned(atlas, slot)
    if (!ready) tails.ask(atlas, slot)
    key.slot = slot
    for (let level = Math.max(0, from); level <= Math.min(to, layout.tail - 1); level++) {
      key.level = level
      for (key.ty = 0; key.ty < layout.down[level]; key.ty++)
        for (key.tx = 0; key.tx < layout.across[level]; key.tx++) {
          // Needed and read by no pixel yet, or not all: stamped as read, never a victim.
          if (atlas.stamp(key)) continue
          ready = false
          ask(atlas, key, weight)
        }
    }
    return ready
  }
  const unwatch = levels?.watch(() => waiting && landed())
  return {
    /** The catalogued meshes. */
    get count() {
      return slots.size
    },
    /** `mesh`'s three map slots; none for a mesh the catalogue does not hold. */
    tilesOf: (mesh: number) => slots.get(mesh),
    /** Whether the cards of `tiles` may be drawn for `ask`: every tile they read resides; what is
     *  missing asked. */
    ready(tiles: CardTiles, { from, to, pixels }: CardAsk) {
      const weight = Math.max(1, ceilDiv(pixels, FEEDBACK_EVERY))
      const colour = mapReady(color, tiles[0], from, to, weight),
        normalDepth = mapReady(data, tiles[1], from, to, weight),
        orm = mapReady(data, tiles[2], from, to, weight)
      const ready = colour && normalDepth && orm
      if (!ready) asked = true
      return ready
    },
    /** A pass begins: the tails asked whose levels are held pinned (`pinAsked`); the cards
     *  that waited since the last pass told by `landed` when it brings them anything. */
    pass() {
      waiting = asked
      asked = false
      return tails.pinAsked()
    },
    /** The pass served `served` tiles beside the `pinned` tails: a card that waits is planned
     *  again. */
    served(served: number, pinned: number) {
      if (waiting && served + pinned > 0) landed()
    },
    dispose: () => unwatch?.(),
  }
}
