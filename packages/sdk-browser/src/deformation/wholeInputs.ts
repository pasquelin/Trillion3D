import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { readComponent } from '../../../sdk-core/src/world/geometry/bounds.ts';

/** Whole-mesh transmission keeps its source representation; inputs are packed once per geometry. */
export function wholeDeformationInputs(
  geometry: Geometry,
  softSourceIds?: readonly number[],
  softVertices = 65536,
) {
  const count = geometry.attributes.position?.count ?? 0;
  const targets = geometry.morphAttributes.position ?? [];
  const skin =
    !!softSourceIds || !!(geometry.attributes.skinIndex && geometry.attributes.skinWeight);
  if (
    softSourceIds &&
    (softSourceIds.length !== count ||
      softSourceIds.some((id) => !Number.isInteger(id) || id < 0 || id >= softVertices))
  )
    throw new Error('PHYSICS_FORMAT');
  const stride = (skin ? 8 : 0) + targets.length * 6;
  // Header: flags, target count, vertex count, stride; then one row of source attributes per vertex.
  const data = new Float32Array(4 + count * stride);
  data.set([softSourceIds ? 80 : skin ? 16 : 0, targets.length, count, stride]);
  for (let vertex = 0; vertex < count; vertex++) {
    let at = 4 + vertex * stride;
    if (skin) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        data[at + k] = softSourceIds
          ? softSourceIds[vertex]
          : readComponent(geometry, geometry.attributes.skinIndex, vertex, k);
        const weight = softSourceIds
          ? Number(k === 0)
          : Math.max(0, readComponent(geometry, geometry.attributes.skinWeight, vertex, k));
        data[at + 4 + k] = weight;
        sum += weight;
      }
      if (!sum) data[at + 4] = 1;
      else for (let k = 0; k < 4; k++) data[at + 4 + k] /= sum;
      at += 8;
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
    skip = data[0] ? 8 : 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const at = 4 + vertex * data[3] + skip;
    result.set(data.subarray(at, at + targets * 6), vertex * targets * 6);
  }
  return result;
}
