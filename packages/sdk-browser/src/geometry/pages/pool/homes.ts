/** Where a page lies in its STREAMING PAGE — the unit one pool slot holds, whole
 *  (`placement.ts`) —: that page's name, and the page's first byte in it. An address the pool is
 *  told none of is a streaming page alone, at its start. */
export type PageUnit = { unit: string; offset: number }
/** Each address's streaming page, as the pool reads it (`../../rows/page/pageSlots.ts`, the census's
 *  `units`): live, a source added to the session joining it in place. */
export type PageUnitsOf = (address: string) => PageUnit | undefined

/** A streaming page's own place in a pool that holds the whole catalogue: its rank, first byte
 *  and width. */
export type PageHome = {
  /** Its rank in the catalogue's order. */
  rank: number
  /** Its first byte in the pool. */
  offset: number
  /** Its width, in bytes. */
  bytes: number
}
/** Every streaming page's home by name, and the bytes they take together. */
export type PageHomes = {
  /** Each streaming page's home, by name. */
  homes: ReadonlyMap<string, PageHome>
  /** The bytes every home takes together. */
  bytes: number
}

/**
 * Each streaming page's own width — the end of its last page, padded to a word — and its home,
 * one after the other in the catalogue's order: its place while the pool holds the catalogue's
 * bytes (`placement.ts`), each of its pages at its offset there. Every reader reaches a page
 * through its offset (`../../residency/residencyFollow.ts`); a decode that reads a word past a
 * page's end keeps none of its bits (`homesDecode.test.ts`), so what lies after a page, a
 * neighbour or nothing, changes no value. `undefined` for a catalogue of no bytes: slots of the
 * widest hold it.
 */
export function pageHomes(widths: ReadonlyMap<string, number>): PageHomes | undefined {
  const homes: PageHomes = { homes: new Map<string, PageHome>(), bytes: 0 }
  extendHomes(homes, widths)
  return homes.bytes > 0 ? homes : undefined
}

/** `homes`, a home added behind the others for each streaming page of `widths` it does not name:
 *  the pages it holds keep their rank, their offset and their width, and the pool that holds the
 *  catalogue grows by the bytes added. `homes` is the owner's, written in place; none is made
 *  of an empty catalogue (`pageHomes`) but by it. A streaming page named already, wider here, is
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
