import { prepareSdkWasm } from '../../wasm/sdkWasm.ts'
import {
  primitiveGridExponent,
  tileLog2,
  uvGridExponent,
} from '../../../../page-codec/src/gridExponent.ts'

/** What the compiler knew of a primitive beside its vertices, which sets its grids: the finest
 *  error its DAG published and the largest world scale that places it. A world's drawn triangles
 *  have neither — no DAG, a metre per unit —; a compiled primitive cut again in session both. */
export type GridInputs = { finestError: number; scale: number }

const DRAWN: GridInputs = { finestError: 0, scale: 0 }

/**
 * The position grid exponent of a primitive of widest `extent` the engine cuts at run time: the
 * compiler's own rules (`packages/page-codec-wasm/src/bits/grid.rs`, `primitive_grid_exponent`),
 * run in the SDK module — a kilometre primitive on its tiled grid, a `blended` one on the finest —,
 * or, when the module is not there, in their TypeScript twin (`page-codec/src/gridExponent.ts`):
 * a page cut either way is the one the compiler writes.
 */
export async function positionGridExponent(
  extent: number,
  blended: boolean,
  inputs: GridInputs = DRAWN,
): Promise<number> {
  const wasm = await prepareSdkWasm()
  const { finestError, scale } = inputs
  if (wasm && typeof wasm.position_grid_exponent === 'function')
    return wasm.position_grid_exponent(extent, Number(blended), finestError, scale)
  // `position_grid_exponent` (`wasm_cone.rs`): an error or a scale not positive is none.
  const finest = finestError > 0 ? finestError : null,
    tile = tileLog2(scale > 0 ? scale : null)
  return primitiveGridExponent(extent, finest, blended, tile)
}

/**
 * The texture grid exponent the compiler gives a primitive whose texture coordinates span `span`
 * (`uv_grid_exponent`, the same module, or its twin): the format's 2^-14, or for a `blended` one
 * the finest grid that span fits.
 */
export async function textureGridExponent(span: number, blended: boolean): Promise<number> {
  const wasm = await prepareSdkWasm()
  if (wasm && typeof wasm.texture_grid_exponent === 'function')
    return wasm.texture_grid_exponent(span, Number(blended))
  return uvGridExponent(span, blended)
}
