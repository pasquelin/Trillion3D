import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';

/**
 * The position grid exponent of a primitive of widest `extent` the world cuts at run time: the
 * compiler's own rule (`packages/page-codec-wasm/src/bits/grid.rs`, `grid_exponent`), run in the SDK
 * module, so a kilometre primitive sits on its tiled grid whichever side cut it, and no second
 * rule exists. `null` when the module is not there: the caller then takes the finest grid a page
 * holds, never coarser than this one, so no pixel is lost.
 */
export async function tiledGridExponent(extent: number): Promise<number | null> {
  const wasm = await prepareSdkWasm();
  if (!wasm || typeof wasm.position_grid_exponent !== 'function') return null;
  return wasm.position_grid_exponent(extent);
}
