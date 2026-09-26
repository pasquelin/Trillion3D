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

/** Writes page `page`'s cone into the cone column: three axis numbers and an angle, all finite,
 *  as the compiler requires; a hand-written page that names none rejects nothing. */
export function writeCone(column: Float64Array, page: number, cone?: Page['cone']) {
  const { axis, angle } = cone ?? { axis: [0, 0, 1], angle: Math.PI };
  const finite =
    Number.isFinite(axis[0]) &&
    Number.isFinite(axis[1]) &&
    Number.isFinite(axis[2]) &&
    Number.isFinite(angle);
  if (axis.length !== 3 || !finite)
    throw new EngineError(
      'INVALID_CACHE',
      'A cluster cone is not three axis numbers and an angle',
      {
        cone,
      },
    );
  column[page * 4] = axis[0];
  column[page * 4 + 1] = axis[1];
  column[page * 4 + 2] = axis[2];
  column[page * 4 + 3] = angle;
}
