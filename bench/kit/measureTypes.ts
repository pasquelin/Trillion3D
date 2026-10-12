// The shapes of a measurement's result: statistics and result rows. The bench's `measure.ts` writes
// them and a health check's verdict reads them; bench imports them from here, never the reverse.

export interface Stats {
  medianeMs: number
  p95Ms: number
  minMs: number
  tours: number
}

/** One measured or described row of a benchmark. */
export interface ResultRow {
  name: string
  size: number | null
  medianeMs: number | null
  p95Ms: number | null
  minMs: number | null
  nsParElement: number | null
  tours: number
  opsParSec: number | null
  temoin: Stats | null
  ecartTemoin: number | null
  correct: boolean | null
  difference: string | null
  motif: string | null
  /** Added by bench's `report.ts` against the domain baseline; absent before that. */
  ecartBaseline?: number | null
}

/** A row no timer fed, `null` never zero: its name, and what verifies it. */
export const resultRow = (
  row: Pick<ResultRow, 'name'> &
    Partial<Pick<ResultRow, 'size' | 'motif' | 'correct' | 'difference'>>,
): ResultRow => ({
  size: null,
  medianeMs: null,
  p95Ms: null,
  minMs: null,
  nsParElement: null,
  tours: 0,
  opsParSec: null,
  temoin: null,
  ecartTemoin: null,
  correct: null,
  difference: null,
  motif: null,
  ...row,
})

/** A named benchmark's result: the file(s) it measures and its rows, one per case. */
export interface Measurement {
  name: string
  fichier: string | string[]
  resultats: ResultRow[]
}
