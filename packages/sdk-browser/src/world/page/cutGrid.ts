import { prepareSdkWasm } from '../../wasm/sdkWasm.ts'

/** What the compiler knew of a primitive beside its vertices, which sets its grids: the finest
 *  error its DAG published and the largest world scale that places it. A world's drawn triangles
 *  have neither — no DAG, a metre per unit —; a compiled primitive cut again in session both. */
export type GridInputs = { finestError: number; scale: number }

const DRAWN: GridInputs = { finestError: 0, scale: 0 }

/**
 * The position grid exponent of a primitive of widest `extent` the engine cuts at run time: the
 * compiler's own rules (`packages/page-codec-wasm/src/bits/grid.rs`, `primitive_grid_exponent`),
 * run in the SDK module — a kilometre primitive on its tiled grid, a `blended` one on the finest —,
 * so no second rule exists. `null` when the module is not there: the caller then takes the finest
 * grid a page holds, never coarser than the tiled one, so no pixel is lost.
 */
export async function positionGridExponent(
  extent: number,
  blended: boolean,
  inputs: GridInputs = DRAWN,
): Promise<number | null> {
  const wasm = await prepareSdkWasm()
  if (!wasm || typeof wasm.position_grid_exponent !== 'function') return null
  return wasm.position_grid_exponent(extent, Number(blended), inputs.finestError, inputs.scale)
}

/**
 * The texture grid exponent the compiler gives a primitive whose texture coordinates span `span`
 * (`uv_grid_exponent`, the same module): the format's 2^-14, or for a `blended` one the finest
 * grid that span fits. `null` when the module is not there.
 */
export async function textureGridExponent(span: number, blended: boolean) {
  const wasm = await prepareSdkWasm()
  if (!wasm || typeof wasm.texture_grid_exponent !== 'function') return null
  return wasm.texture_grid_exponent(span, Number(blended))
}
