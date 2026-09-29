import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { skinStreams } from '../../../sdk-core/src/world/geometry/skin.ts';
import { wholeMorphDeltas } from './wholeInputs.ts';

/** One existing deformation texture: all skin pairs, then the target vectors, per source vertex. */
export function deformationTexels(geometry: Geometry, targets: number) {
  const skin = skinStreams(geometry),
    count = geometry.attributes.position?.count ?? 0;
  const deltas = targets ? (geometry.attributes.morph?.array ?? wholeMorphDeltas(geometry)) : [];
  const stride = skin.width + targets * 2,
    data = new Float32Array(count * stride * 4);
  for (let v = 0; v < count; v++) {
    const at = v * stride * 4;
    for (let k = 0; k < skin.width; k++) {
      data[at + k * 4] = skin.read(v, k, false);
      data[at + k * 4 + 1] = skin.read(v, k, true);
    }
    for (let t = 0; t < targets * 2; t++)
      for (let c = 0; c < 3; c++)
        data[at + (skin.width + t) * 4 + c] = deltas[v * targets * 6 + t * 3 + c];
  }
  return data;
}
