import type { PageRec } from '../selection/types.ts'
import { pageUnit } from '../rows/page/pageSlots.ts'

/**
 * THE STREAMING PAGES OF THE CATALOGUE, by number: the unit the residency requests, starts,
 * installs, keeps and gives up (`./queue.ts`), as the geometry pool places one in one slot
 * (`../pages/pool/placement.ts`) — a compiled streaming page, 128 KiB at most
 * (`asset-compiler-rust/src/compiler/pages/bundles.rs`), or a page alone where the cache gives it
 * none (`pageUnit`). Each holds the keys of its addresses (`../rows/page/pageTracking.ts`) and the
 * first record of each, in the order filed; a unit keeps its number for the session, those a
 * source added later behind those it holds.
 */
export function createPageUnits() {
  const unitOfKey: number[] = []
  const keysOf: number[][] = []
  const recordsOf: PageRec[][] = []
  const numbers = new Map<string, number>()
  return {
    /** Files key `key`, `page`'s address, in its streaming page. */
    file(key: number, page: PageRec) {
      const { unit: name } = pageUnit(page)
      let unit = numbers.get(name)
      if (unit === undefined) {
        unit = keysOf.length
        numbers.set(name, unit)
        keysOf.push([])
        recordsOf.push([])
      }
      unitOfKey[key] = unit
      keysOf[unit].push(key)
      recordsOf[unit].push(page)
    },
    /** The streaming page key `key` lies in. */
    of: (key: number) => unitOfKey[key],
    /** The keys of streaming page `unit`, in the order filed. */
    keys: (unit: number): readonly number[] => keysOf[unit],
    /** The record of each key of `unit`, beside it. */
    records: (unit: number): readonly PageRec[] => recordsOf[unit],
    /** Streaming pages numbered. */
    get count() {
      return keysOf.length
    },
  }
}

export type PageUnits = ReturnType<typeof createPageUnits>
