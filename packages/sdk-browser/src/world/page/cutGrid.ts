import { primitiveGridExponent, tileLog2 } from '../../../../page-codec/src/gridExponent.ts'

/** What the compiler knew of a primitive beside its vertices, which sets its grids: the finest
 *  error its DAG published and the largest world scale that places it, each null when unknown. A
 *  world's drawn triangles have neither — no DAG, a metre per unit —; a compiled primitive cut
 *  again in session both. */
export type GridInputs = { finestError: number | null; scale: number | null }

const DRAWN: GridInputs = { finestError: null, scale: null }

/**
 * The position grid exponent of a primitive of widest `extent` the engine cuts at run time: the
 * compiler's own rules (`packages/page-codec-wasm/src/bits/grid.rs`, `primitive_grid_exponent`)
 * in their TypeScript twin (`page-codec/src/gridExponent.ts`), the same integers on every host —
 * a kilometre primitive on its tiled grid, a `blended` one on the finest —: a page cut here is
 * the one the compiler writes.
 */
export const positionGridExponent = (
  extent: number,
  blended: boolean,
  { finestError, scale }: GridInputs = DRAWN,
) => primitiveGridExponent(extent, finestError, blended, tileLog2(scale))
