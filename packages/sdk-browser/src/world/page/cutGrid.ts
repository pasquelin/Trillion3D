import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';

/**
 * The position grid exponent of a primitive of widest `extent` the world cuts at run time: the
 * compiler's own rules (`packages/page-codec-wasm/src/bits/grid.rs`, `primitive_grid_exponent`), run in
 * the SDK module — a kilometre primitive on its tiled grid, a `blended` one on the finest —, so
 * no second rule exists. `null` when the module is not there: the caller then takes the finest
 * grid a page holds, never coarser than the tiled one, so no pixel is lost.
 */
export async function positionGridExponent(extent: number, blended: boolean): Promise<number | null> {
  const wasm = await prepareSdkWasm();
  if (!wasm || typeof wasm.position_grid_exponent !== 'function') return null;
  return wasm.position_grid_exponent(extent, Number(blended));
}
