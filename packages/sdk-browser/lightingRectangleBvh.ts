import type { Scene } from '../sdk-core/lightingExperimentScene.ts';

/** Preorder binary tree; each node stores min.xyz/escape and max.xyz/surface.
 * An internal node has surface=-1 and its first child immediately follows it.
 * Escape indices strictly increase, so a shader visits at most 2*S-1 nodes.
 * The topology is built once; refits use the float32 rectangle records consumed
 * by the shader, preserving moving doors and emitters without rebuilding cuts.
 */
export function createRectangleBvh(surfaces: Scene['surfaces']) {
  const nodeCount = 2 * surfaces.length - 1,
    data = new Float32Array(nodeCount * 8);
  const rightChildren = new Int32Array(nodeCount).fill(-1);
  const centers = surfaces.map((surface) =>
    surface.origin.map((value, axis) => value + 0.5 * (surface.u[axis] + surface.v[axis])),
  );
  if (centers.some((center) => center.some((value) => !Number.isFinite(value))))
    throw new Error('Lighting experiment BVH requires finite rectangle coordinates');
  let nextNode = 0;
  const build = (indices: number[]): number => {
    const node = nextNode++,
      offset = node * 8;
    if (indices.length === 1) data[offset + 7] = indices[0];
    else {
      data[offset + 7] = -1;
      let axis = 0,
        largestExtent = -1;
      for (let candidate = 0; candidate < 3; candidate++) {
        let minimum = Infinity,
          maximum = -Infinity;
        for (const index of indices) {
          minimum = Math.min(minimum, centers[index][candidate]);
          maximum = Math.max(maximum, centers[index][candidate]);
        }
        if (maximum - minimum > largestExtent) {
          largestExtent = maximum - minimum;
          axis = candidate;
        }
      }
      indices.sort((a, b) => centers[a][axis] - centers[b][axis] || a - b);
      const middle = Math.floor(indices.length / 2);
      build(indices.slice(0, middle));
      rightChildren[node] = build(indices.slice(middle));
    }
    data[offset + 3] = nextNode;
    return node;
  };
  build(surfaces.map((_, index) => index));
  const refit = (surfaceData: Float32Array) => {
    for (let node = nodeCount - 1; node >= 0; node--) {
      const offset = node * 8,
        surface = data[offset + 7];
      if (surface >= 0) {
        const record = surface * 24;
        for (let axis = 0; axis < 3; axis++) {
          const origin = surfaceData[record + axis],
            u = surfaceData[record + 4 + axis],
            v = surfaceData[record + 8 + axis];
          const low = origin + Math.min(0, u) + Math.min(0, v),
            high = origin + Math.max(0, u) + Math.max(0, v);
          // The absolute term also thickens planar boxes; the relative term exceeds
          // float32 storage rounding and leaves margin for shader point arithmetic.
          const padding =
            1e-4 +
            1e-6 *
              Math.max(Math.abs(origin), Math.abs(u), Math.abs(v), Math.abs(low), Math.abs(high));
          data[offset + axis] = low - padding;
          data[offset + 4 + axis] = high + padding;
        }
      } else {
        const left = (node + 1) * 8,
          right = rightChildren[node] * 8;
        for (let axis = 0; axis < 3; axis++) {
          data[offset + axis] = Math.min(data[left + axis], data[right + axis]);
          data[offset + 4 + axis] = Math.max(data[left + 4 + axis], data[right + 4 + axis]);
        }
      }
    }
  };
  return { data, nodeCount, refit };
}
