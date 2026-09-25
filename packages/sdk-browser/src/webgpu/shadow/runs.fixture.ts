import {
  composeFace,
  shadowOrthographic,
} from '../../../../sdk-core/src/scene/light-shadow/math.ts';
import { createShadowRuns } from './runs.ts';

/**
 * One run of a sun looking down −z from z = 10, over a window 8 metres wide in 8 × 8 pages of
 * `side / 8` texels, drawing pages `[x0, x1] × [y0, y1]`: its selection view in the render frame
 * at `origin`. What the light cut tests select from, on the GPU oracle and on the CPU cut alike.
 */
export function sunRun(
  side: number,
  origin: number[] = [0, 0, 0],
  [x0, x1, y0, y1]: readonly number[] = [0, 7, 0, 7],
) {
  const runs = createShadowRuns();
  runs.open(0, 0);
  const xs: number[] = [],
    ys: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      runs.add(x, y);
      xs.push(x);
      ys.push(y);
    }
  runs.shape(8);
  shadowOrthographic(4, 20);
  composeFace(new Float32Array(16), 0, [0, 0, 10], [0, 0, -1]);
  runs.close(origin, 1, side, 8, xs, ys);
  return runs.list[0];
}
