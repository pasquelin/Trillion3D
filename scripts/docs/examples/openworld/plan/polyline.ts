/** Polyline helpers of the world plan (#332): rounding grid paths and resampling them evenly. */

export type Point2 = readonly [number, number];

/** Chaikin corner cutting: each pass rounds every corner, keeping both end points. */
export function chaikin(points: readonly Point2[], passes: number): Point2[] {
  let current = [...points];
  for (let pass = 0; pass < passes && current.length > 2; pass++) {
    const next: Point2[] = [current[0]];
    for (let index = 0; index < current.length - 1; index++) {
      const [ax, az] = current[index],
        [bx, bz] = current[index + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/** Points every `step` metres along a polyline, both end points included. */
export function resample(points: readonly Point2[], step: number): Point2[] {
  const out: Point2[] = [points[0]];
  let carried = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const [ax, az] = points[index],
      [bx, bz] = points[index + 1],
      length = Math.hypot(bx - ax, bz - az);
    let at = step - carried;
    for (; at < length; at += step)
      out.push([ax + ((bx - ax) * at) / length, az + ((bz - az) * at) / length]);
    carried = length - (at - step);
  }
  const last = points[points.length - 1],
    tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Moving average of `values` over `radius` neighbours on each side (shorter at the ends). */
export function smooth(values: readonly number[], radius: number): number[] {
  return values.map((_, index) => {
    let sum = 0,
      count = 0;
    for (
      let k = Math.max(0, index - radius);
      k <= Math.min(values.length - 1, index + radius);
      k++
    ) {
      sum += values[k];
      count++;
    }
    return sum / count;
  });
}

/**
 * A profile no steeper than `grade` between neighbours, as close to `values` as two sweeps make
 * it: the mean of a forward and a backward clamp, each of which holds the limit.
 */
export function limitGrade(
  values: readonly number[],
  points: readonly Point2[],
  grade: number,
): number[] {
  const run = (k: number) =>
      grade * Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1]),
    forward = [...values],
    backward = [...values];
  for (let k = 1; k < values.length; k++)
    forward[k] = Math.min(
      forward[k - 1] + run(k - 1),
      Math.max(forward[k - 1] - run(k - 1), forward[k]),
    );
  for (let k = values.length - 2; k >= 0; k--)
    backward[k] = Math.min(
      backward[k + 1] + run(k),
      Math.max(backward[k + 1] - run(k), backward[k]),
    );
  return forward.map((value, k) => (value + backward[k]) / 2);
}
