import { regionRect } from '../../../../sdk-core/src/index.ts';
import {
  composeFace,
  shadowOrthographic,
} from '../../../../sdk-core/src/scene/light-shadow/math.ts';
import { createShadowRuns } from './runs.ts';

/**
 * One face run of a sun looking down −z from z = 10, 8 metres wide in 8 × 8 pages and `side`
 * texels, redrawing pages `[x0, x1] × [y0, y1]`: its selection view in the render frame at
 * `origin`. What the light cut tests select from, on the GPU oracle and on the CPU cut alike.
 */
export function sunRun(
  side: number,
  origin: number[] = [0, 0, 0],
  [x0, x1, y0, y1]: readonly number[] = [0, 7, 0, 7],
) {
  const runs = createShadowRuns();
  shadowOrthographic(4, 20);
  composeFace(new Float32Array(16), 0, [0, 0, 10], [0, 0, -1]);
  runs.open(0, side, 8, 0);
  runs.add(x0, x1, y0, y1, regionRect(new Float64Array(4), 8, x0, x1, y0, y1));
  runs.close(origin, 1);
  return runs.list[0];
}
