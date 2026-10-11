import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** What the compiler knew of a primitive beside its vertices, which sets its grids: the finest
 *  error its DAG published and the largest world scale that places it, each null when unknown. A
 *  world's drawn triangles have neither — no DAG, a metre per unit —; a compiled primitive cut
 *  again in session both. */
export type GridInputs = { finestError: number | null; scale: number | null }

const DRAWN: GridInputs = { finestError: null, scale: null }

/**
 * The position grid exponent of a primitive of widest `extent` the engine cuts at run time: the
 * compiler's own rules (`packages/page-codec-wasm/src/bits/grid.rs`, `primitive_grid_exponent`),
 * run in the SDK module that encodes the page, the same integers on every host — a kilometre
 * primitive on its tiled grid, a `blended` one on the finest —: a page cut here is the one the
 * compiler writes.
 */
export const positionGridExponent = (
  module: SdkWasm,
  extent: number,
  blended: boolean,
  { finestError, scale }: GridInputs = DRAWN,
) =>
  module.grid_position_exponent(
    extent,
    finestError ?? NaN,
    Number(blended),
    module.grid_tile_log2(scale ?? NaN),
  )

/** The texture grid of a compiled primitive whose coordinates span `span` (`uv_grid_exponent`). */
export const uvGridExponent = (module: SdkWasm, span: number, blended: boolean) =>
  module.grid_uv_exponent(span, Number(blended))

/** The texture grid of drawn triangles whose widest page spans `span`
 *  (`drawn_uv_grid_exponent`): the run-time cut's rule alone, no compiled primitive takes it. */
export const drawnUvGridExponent = (module: SdkWasm, span: number, blended: boolean) =>
  module.grid_drawn_uv_exponent(span, Number(blended))
