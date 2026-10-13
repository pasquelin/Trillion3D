import { createRowPageState } from './pageState.ts'

/** A row table's per-page state over `count` pages of no record: their rows and flags alone, what
 *  the demand reads (`rowDemand.ts`). */
export const pageStateOf = (count: number) =>
  createRowPageState(
    () => undefined,
    () => count,
  )

/** A page cache's slots as the row state reads them (`slotWords`), each address's set by hand: -1
 *  gives it back. */
export function slotTable() {
  const words = new Map<string, number>()
  return {
    read: (address: string) => words.get(address) ?? -1,
    set(address: string, slot: number) {
      if (slot < 0) words.delete(address)
      else words.set(address, slot)
    },
  }
}
