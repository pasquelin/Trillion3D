import { createRowPageState } from './pageState.ts'

/** A row table's per-page state over `count` pages of no record: their rows and flags alone, what
 *  the demand reads (`rowDemand.ts`). */
export const pageStateOf = (count: number) =>
  createRowPageState(
    () => undefined,
    () => count,
  )
