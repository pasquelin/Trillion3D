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
 * The pool's layout when the whole catalogue fits: each page at its own width — its bytes padded
 * to a word, raised to the end of its own deformation tails, which stay at their offset
 * (`../../deformation/slotLayout.ts`) — one after the other in the catalogue's order, where a
 * fixed slot gives every page the width of the widest. Every reader reaches a page through its
 * offset (`../../webgpu/residency/mirror.ts`); a decode that reads a word past a page's end
 * keeps none of its bits (`homesDecode.test.ts`), so what lies after a page, a neighbour or
 * nothing, changes no value. `undefined` for a catalogue of no bytes: fixed slots hold it.
 */
export function pageHomes(widths: ReadonlyMap<string, number>): PageHomes | undefined {
  const homes = new Map<string, PageHome>()
  let bytes = 0
  for (const [key, width] of widths) {
    if (!Number.isSafeInteger(width) || width < 0 || width % 4) throw new Error('INVALID_PAGE_HOME')
    homes.set(key, { rank: homes.size, offset: bytes, bytes: width })
    bytes += width
  }
  return bytes > 0 ? { homes, bytes } : undefined
}

/** The homes a pool of `slots` places its pages in: those of the whole catalogue when it holds
 *  it, none — fixed slots — otherwise. */
export const heldHomes = (homes: PageHomes | undefined, slots: number) =>
  homes && slots >= homes.homes.size ? homes : undefined
