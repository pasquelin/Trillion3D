/** A page's own place in a pool that holds the whole catalogue: its rank, first byte and width. */
export type PageHome = {
  /** Its rank in the catalogue's order. */
  rank: number
  /** Its first byte in the pool. */
  offset: number
  /** Its width, in bytes. */
  bytes: number
}
/** Every page's home by key, and the bytes they take together. */
export type PageHomes = {
  /** Each page's home, by key. */
  homes: ReadonlyMap<string, PageHome>
  /** The bytes every home takes together. */
  bytes: number
}

/**
 * Each page's own width — its bytes padded to a word, raised to the end of its own deformation
 * tails, which stay at their offset (`../../../deformation/outputs.ts`) — and its home, one after the
 * other in the catalogue's order: the width the pool's allocator gives the page, and its place
 * while the pool holds the catalogue's bytes (`placement.ts`). Every reader reaches a page through its
 * offset (`../../residency/residencyFollow.ts`); a decode that reads a word past a page's end
 * keeps none of its bits (`homesDecode.test.ts`), so what lies after a page, a neighbour or
 * nothing, changes no value. `undefined` for a catalogue of no bytes: grains of the widest hold it.
 */
export function pageHomes(widths: ReadonlyMap<string, number>): PageHomes | undefined {
  const homes: PageHomes = { homes: new Map<string, PageHome>(), bytes: 0 }
  extendHomes(homes, widths)
  return homes.bytes > 0 ? homes : undefined
}

/** `homes`, a home added behind the others for each address of `widths` it does not name: the
 *  pages it holds keep their rank, their offset and their width, and the pool that holds the
 *  catalogue grows by the bytes added. `homes` is the owner's, written in place; none is made
 *  of an empty catalogue (`pageHomes`) but by it. An address named already, wider here, is
 *  refused: a page that grew keeps no place. */
export function extendHomes(homes: PageHomes, widths: ReadonlyMap<string, number>) {
  const held = homes.homes as Map<string, PageHome>
  for (const [key, width] of widths) {
    if (!Number.isSafeInteger(width) || width < 0 || width % 4) throw new Error('INVALID_PAGE_HOME')
    const home = held.get(key)
    if (home) {
      if (width > home.bytes) throw new Error('PAGE_HOME_OUTGROWN')
      continue
    }
    held.set(key, { rank: held.size, offset: homes.bytes, bytes: width })
    homes.bytes += width
  }
}
