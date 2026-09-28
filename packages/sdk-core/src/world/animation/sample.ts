import { normalizeQuaternion } from '../../math/matrix/quaternion.ts';
import type { Track, TrackBinding } from './index.ts';

/** The track's value at `t` between its two keys, from the last key reached; quaternions on the arc. */
export function sample(tr: Track, t: number, bound: TrackBinding) {
  const { times, values } = tr,
    out = bound.value,
    size = out.length;
  let i = bound.key > 0 && times[bound.key] < t ? bound.key : 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  bound.key = i;
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i],
    w = span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 0;
  let sign = 1;
  if (tr.kind === 'quaternion') {
    let dot = 0;
    for (let c = 0; c < 4; c++) dot += values[i * 4 + c] * values[j * 4 + c];
    sign = dot < 0 ? -1 : 1;
  }
  for (let c = 0; c < size; c++)
    out[c] = values[i * size + c] * (1 - w) + sign * values[j * size + c] * w;
  if (tr.kind === 'quaternion') normalizeQuaternion(out);
  return out;
}
