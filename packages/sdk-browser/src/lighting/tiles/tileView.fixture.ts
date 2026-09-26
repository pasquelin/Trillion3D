import {
  invertMatrix4,
  multiplyMatrix4,
  perspectiveProjection,
} from '../../../../sdk-core/src/index.ts';
import type { TileView } from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';

const width = 1920,
  height = 1080;
/** A 1920 × 1080 view down −z from `eye`, 60° high, as the tile pass reads it. */
export function view(eye: [number, number, number]): TileView {
  const projection = perspectiveProjection(new Float64Array(16), 60, width / height, 0.1, 1);
  const translate = new Float64Array([
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    -eye[0],
    -eye[1],
    -eye[2],
    1,
  ]);
  const viewProjection = multiplyMatrix4(new Float64Array(16), projection, translate);
  return {
    inverseViewProjection: invertMatrix4(new Float64Array(16), viewProjection),
    width,
    height,
  };
}
