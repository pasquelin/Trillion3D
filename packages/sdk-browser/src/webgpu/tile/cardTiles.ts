import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import type { TileKey } from './pageTable.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createFileTails } from './fileTails.ts'
import { FEEDBACK_EVERY } from './feedback.ts'
import { tileId } from './ids.ts'

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

/** What a mesh's cards hold of its maps (`ready`): the levels they were last asked at, whether
 *  every tile of them resided, the pools of both atlases then, and the tiles pinned per map. */
export type CardHold = {
  from: number
  to: number
  ready: boolean
  pools: [color: unknown, data: unknown]
  held: [colour: Set<number>, normalDepth: Set<number>, orm: Set<number>]
}

/** A hold of nothing: no level asked yet. */
export const createCardHold = (): CardHold => ({
  from: 0,
  to: -1,
  ready: false,
  pools: [undefined, undefined],
  held: [new Set(), new Set(), new Set()],
})

/**
 * THE IMPOSTOR MAPS' RESIDENCY, in the one tile pool: each baked mesh's three maps are textures of
 * the atlases (`cardMaps.ts`) — colour and coverage in the colour atlas, normal and depth and the
 * packed ORM in the data atlas —, held, evicted and budgeted as every texture is. A card is drawn
 * only once every tile of the levels its cards read — from the finest to one past the coarsest
 * (`CardAsk`) — resides in all three maps and their tails are pinned: it then reads what the
 * hardware read of a whole chain, never a coarser stand-in, and until then its mesh keeps its
 * clusters (no image lost). A card not drawn posts no feedback: what it waits for, the CPU asks
 * (`requests.ts`, `fileTails.ts`), weighted by the pixels its nearest card covers as the feedback
 * would count them, one in `FEEDBACK_EVERY`. Every tile it needs that resides is pinned while its
 * mesh holds it (`CardHold`, `WebgpuTileAtlas.pin`) — out of the queue as a tail is: a level its
 * cards need and no pixel reads — the card waiting, or drawn at levels it does not all read — is
 * never a victim, so a full pool cannot turn a card back to its clusters and again. The hold is let
 * go when the levels asked move, the pools are replaced, or the mesh leaves the view (`release`).
 *
 * The CPU reacts to a change, never waits on the GPU: a hold whose levels all reside and whose ask
 * stands costs one comparison an image; only a mesh that waits walks its tiles again, to ask what
 * is missing. A level landing or a tile served while a card waits breaks a held image (`landed`),
 * so the card is planned again. The tails are read through the sources' held levels and written on
 * the device's queue in `encoding`'s lossless lane (`fileTails.ts`).
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
    { ask: askTile } = streamer.requests
  const tails = createFileTails({ queue: streamer.device.queue, levels, encoding, failed })
  const key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }
  /** A card found waiting since the last pass; one the last pass found. */
  let asked = false,
    waiting = false
  /** The atlas of map `m` of a mesh: its colour in the colour atlas, the others in the data. */
  const atlasOf = (m: number) => (m === 0 ? color : data)
  /** Whether every tile of `slot` from level `from` to `to` resides and its tail is pinned, each
   *  one that resides pinned into `held`; each one missing asked at `weight`, none stopping the
   *  asks of the others. */
  const holdMap = (
    held: Set<number>,
    atlas: WebgpuTileAtlas,
    slot: number,
    { from, to }: CardAsk,
    weight: number,
  ) => {
    const { layout } = atlas.textures[slot]
    let ready = atlas.tailPinned(slot)
    if (!ready) tails.ask(atlas, slot)
    key.slot = slot
    for (let level = Math.max(0, from); level <= Math.min(to, layout.tail - 1); level++) {
      key.level = level
      for (key.ty = 0; key.ty < layout.down[level]; key.ty++)
        for (key.tx = 0; key.tx < layout.across[level]; key.tx++) {
          const id = tileId(key)
          if (held.has(id)) continue
          // Needed, and maybe read by no pixel: pinned while held, never a victim.
          if (atlas.pin(id, true)) held.add(id)
          else {
            ready = false
            askTile(atlas, key, weight)
          }
        }
    }
    return ready
  }
  /** Lets `hold`'s tiles go back to the queue. */
  const release = (hold: CardHold) => {
    if (hold.to < 0) return
    hold.held.forEach((held, m) => {
      for (const id of held) atlasOf(m).pin(id, false)
      held.clear()
    })
    hold.to = -1
    hold.ready = false
  }
  const unwatch = levels?.watch(() => waiting && landed())
  return {
    /** The catalogued meshes. */
    get count() {
      return slots.size
    },
    /** `mesh`'s three map slots; none for a mesh the catalogue does not hold. */
    tilesOf: (mesh: number) => slots.get(mesh),
    /** Whether the cards of `tiles` may be drawn for `ask`: every tile they read resides, held by
     *  `hold`; what is missing asked. A hold whose levels all reside and whose ask and pools stand
     *  answers at once. */
    ready(tiles: CardTiles, ask: CardAsk, hold: CardHold) {
      const moved =
        hold.from !== ask.from ||
        hold.to !== ask.to ||
        hold.pools[0] !== color.pools ||
        hold.pools[1] !== data.pools
      if (!moved && hold.ready) return true
      if (moved) release(hold)
      hold.from = ask.from
      hold.to = ask.to
      hold.pools[0] = color.pools
      hold.pools[1] = data.pools
      const weight = Math.max(1, ceilDiv(ask.pixels, FEEDBACK_EVERY))
      let ready = true
      for (let m = 0; m < 3; m++)
        ready = holdMap(hold.held[m], atlasOf(m), tiles[m], ask, weight) && ready
      hold.ready = ready
      if (!ready) asked = true
      return ready
    },
    /** `hold`'s tiles let go: its mesh left the view, or its cards went. */
    release,
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
