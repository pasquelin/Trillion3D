import { skinStreams } from '../../../sdk-core/src/world/geometry/skin.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { readComponent } from '../../../sdk-core/src/world/geometry/bounds.ts';
import { FLAG_SKIN, FLAG_SOFT_SOURCE } from '../cluster/format.ts';

/** Throws `PHYSICS_FORMAT` unless `ids` names one simulated vertex below `softVertices` for each
 *  of `count` vertices. */
export function checkSoftSourceIds(count: number, ids: readonly number[], softVertices = 65536) {
  if (
    ids.length !== count ||
    ids.some((id) => !Number.isInteger(id) || id < 0 || id >= softVertices)
  )
    throw new Error('PHYSICS_FORMAT');
}

/** Whole-mesh transmission keeps its source representation; inputs are packed once per geometry. */
export function wholeDeformationInputs(
  geometry: Geometry,
  softSourceIds?: readonly number[],
  softVertices = 65536,
) {
  const count = geometry.attributes.position?.count ?? 0;
  const targets = geometry.morphAttributes.position ?? [];
  const streams = skinStreams(geometry),
    width = softSourceIds ? 4 : streams.width;
  const skin = width > 0;
  if (softSourceIds) checkSoftSourceIds(count, softSourceIds, softVertices);
  const stride = 2 * width + targets.length * 6;
  // Header: flags, target count, vertex count, stride; then one row of source attributes per vertex.
  const data = new Float32Array(4 + count * stride);
  data.set([
    softSourceIds ? FLAG_SOFT_SOURCE | FLAG_SKIN : skin ? FLAG_SKIN : 0,
    targets.length,
    count,
    stride,
  ]);
  for (let vertex = 0; vertex < count; vertex++) {
    let at = 4 + vertex * stride;
    if (skin) {
      for (let k = 0; k < width; k++) {
        data[at + k] = softSourceIds ? softSourceIds[vertex] : streams.read(vertex, k, false);
        data[at + width + k] = softSourceIds ? Number(k === 0) : streams.read(vertex, k, true);
      }
      at += 2 * width;
    }
    for (let t = 0; t < targets.length; t++) {
      const normal = geometry.morphAttributes.normal?.[t];
      for (let c = 0; c < 3; c++) {
        data[at + c] =
          readComponent(geometry, targets[t], vertex, c) -
          (geometry.morphTargetsRelative
            ? 0
            : readComponent(geometry, geometry.attributes.position, vertex, c));
        if (normal)
          data[at + 3 + c] =
            readComponent(geometry, normal, vertex, c) -
            (geometry.morphTargetsRelative || !geometry.attributes.normal
              ? 0
              : readComponent(geometry, geometry.attributes.normal, vertex, c));
      }
      at += 6;
    }
  }
  return data;
}

/** The same morph deltas in the WebGL vertex texture's per-vertex order. */
export function wholeMorphDeltas(geometry: Geometry) {
  const data = wholeDeformationInputs(geometry),
    count = data[2],
    targets = data[1];
  const result = new Float32Array(count * targets * 6),
    skip = data[3] - targets * 6;
  for (let vertex = 0; vertex < count; vertex++) {
    const at = 4 + vertex * data[3] + skip;
    result.set(data.subarray(at, at + targets * 6), vertex * targets * 6);
  }
  return result;
}
