/** The page words the encoder checks before it writes them, as the compiler refuses them
 *  (`asset-compiler-rust/src/manifest_binary/page.rs`). */
import { EngineError, type Page } from '../contracts/index.ts';
import { MAX_DEPTH_LAYER } from '../lod/depthLayer.ts';

/** A cluster's coplanar depth layer, refused unless it fits the four bits the cache gives it. */
export function checkedDepthLayer(depthLayer: number) {
  if (!Number.isInteger(depthLayer) || depthLayer < 0 || depthLayer > MAX_DEPTH_LAYER)
    throw new EngineError('INVALID_CACHE', 'A cluster depth layer does not fit four bits', {
      depthLayer,
    });
  return depthLayer;
}

/** Writes page `page`'s cone into the cone column: three finite axis numbers and a finite angle,
 *  as the compiler requires. Only an absent cone is open (a hand-written page); a `null` or
 *  malformed one is refused, never read as open nor thrown as a `TypeError`. */
export function writeCone(
  column: Float64Array,
  page: number,
  cone: Page['cone'] | null = { axis: [0, 0, 1], angle: Math.PI },
) {
  const axis: unknown = cone?.axis;
  // `Array.from` turns a hole into `undefined`, which `every` alone would skip and `set` write as NaN.
  if (!Array.isArray(axis) || axis.length !== 3 || !Array.from(axis).every(Number.isFinite))
    throw new EngineError('INVALID_CACHE', 'A cluster cone is not three axis numbers', { cone });
  if (!Number.isFinite(cone!.angle))
    throw new EngineError('INVALID_CACHE', 'A cluster cone angle is not finite', { cone });
  column.set(axis as number[], page * 4);
  column[page * 4 + 3] = cone!.angle;
}
