import { laneCounts } from '../../../texture/blockFormats.ts'
import type { TileTexture } from '../../tile/tileTexture.ts'
import type { WebgpuTileStreamer } from '../../tile/streamer.ts'

/* What the census of the material textures weighs per lane, and what a diagnostic says of it: at
 * prepare (`textures.ts`) and when a texture is appended after open (`../io/appendTexture.ts`). */

/** `each` of the live textures, summed per lane. The white fill (slot 0) never opens a lane: it
 *  counts only in one a map opens, read from the white stand-in otherwise (`lanes.ts`), so no
 *  layer is allocated before the first map. */
const perLane = (textures: readonly TileTexture[], each: (texture: TileTexture) => number) => {
  const counts = laneCounts(),
    [fill] = textures
  for (let slot = 1; slot < textures.length; slot++)
    if (!textures[slot].retired) counts[textures[slot].lane] += each(textures[slot])
  if (fill && counts[fill.lane]) counts[fill.lane] += each(fill)
  return counts
}
/** Tiles each lane's textures would hold at full residency: their tails and streamed entries. */
export const laneDemand = (textures: readonly TileTexture[]) =>
  perLane(textures, (texture) => 1 + texture.layout.entries)
/** Textures per lane: the tails the pool keeps resident whole, one tile each. */
export const laneTails = (textures: readonly TileTexture[]) => perLane(textures, () => 1)

/** What a diagnostic says of a catalogue: how many textures per source and per lane, their tiles. */
export const catalogueReport = (textures: readonly TileTexture[]) => ({
  count: textures.filter((texture) => !texture.retired).length - 1,
  baked: textures.filter((texture) => texture.source.kind === 'baked').length,
  tailOnly:
    textures.filter((texture) => !texture.retired && texture.source.kind === 'bytes').length - 1,
  host: textures.filter((texture) => texture.source.kind === 'host').length,
  lanes: laneTails(textures),
  streamedTiles: textures.reduce((total, texture) => total + texture.layout.entries, 0),
})

/** What a diagnostic says of each atlas's page table: its textures and the bytes of its buffer. */
export const pageTablesReport = ({ color, data }: Pick<WebgpuTileStreamer, 'color' | 'data'>) =>
  Object.fromEntries(
    [color, data].map(({ kind, textures, pages }) => [
      kind,
      { slots: textures.length, bytes: pages.buffer.size },
    ]),
  )
