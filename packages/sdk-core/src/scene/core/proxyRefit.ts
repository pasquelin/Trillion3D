import type { SceneProxyColumns } from '../../contracts/proxy.ts';

const rounded = new Float32Array(1);
const bits = new Uint32Array(rounded.buffer);
/** Round a bound outwards, including negative zero and subnormals. */
function outward(value: number, upper: boolean) {
  rounded[0] = value;
  if (upper ? rounded[0] < value : rounded[0] > value) {
    if (rounded[0] === 0) bits[0] = upper ? 1 : 0x80000001;
    else bits[0] += rounded[0] > 0 === upper ? 1 : -1;
  }
  return rounded[0];
}

/** Canonical bounds of each proxy triangle, six per triangle: what a still pose covers. */
export function proxyTriangleBoxes(triangles: Float32Array) {
  const boxes = new Float64Array((triangles.length / 9) * 6);
  for (let t = 0; t < boxes.length / 6; t++)
    for (let a = 0; a < 3; a++) {
      const x = triangles[t * 9 + a],
        y = triangles[t * 9 + 3 + a],
        z = triangles[t * 9 + 6 + a];
      boxes[t * 6 + a] = Math.min(x, y, z);
      boxes[t * 6 + a + 3] = Math.max(x, y, z);
    }
  return boxes;
}

/** Refit the existing wide topology; triangles and their order never change. */
export function createProxyRefit(data: SceneProxyColumns) {
  const { triangles, triangleGroups, groupOffsets, owners, nodeBounds, nodeChildren } = data;
  const starts = new Uint32Array(groupOffsets.length);
  for (const group of triangleGroups) starts[group + 1]++;
  for (let group = 1; group < starts.length; group++) starts[group] += starts[group - 1];
  const slots = new Uint32Array(triangleGroups.length),
    cursors = starts.slice();
  const bounds = proxyTriangleBoxes(triangles);
  const errors = new Float64Array(triangleGroups.length * 3);
  const changed = new Uint8Array(triangleGroups.length);
  const nodeChanged = new Uint8Array(nodeBounds.length / 6);
  // Nodes whose effective box left the built tree: a refitted node, and each inner child it
  // requantizes. Only those can enter a ray the built tree kept out, so they bound the extra
  // steps a moved tree may take. Kept once marked: a settled pose keeps the refitted topology.
  const grown = new Uint8Array(nodeChanged.length);
  let grownNodes = 0;
  const grow = (node: number) => {
    if (!grown[node]) grownNodes++;
    grown[node] = 1;
  };
  for (let t = 0; t < triangleGroups.length; t++) {
    slots[cursors[triangleGroups[t]]++] = t;
  }
  const boxes = new Float64Array(24);
  const refit = (groups: ReadonlySet<number>, transforms: Float32Array, extent: number[]) => {
    changed.fill(0);
    nodeChanged.fill(0);
    for (const group of groups)
      for (let rank = starts[group]; rank < starts[group + 1]; rank++) {
        const t = slots[rank];
        changed[t] = 1;
        const at = t * 6;
        errors.fill(0, t * 3, t * 3 + 3);
        bounds.fill(Infinity, at, at + 3);
        bounds.fill(-Infinity, at + 3, at + 6);
        for (let owner = groupOffsets[group]; owner < groupOffsets[group + 1]; owner++) {
          const matrix = owners[owner * 2] * 16;
          for (let v = 0; v < 3; v++)
            for (let a = 0; a < 3; a++) {
              const p = t * 9 + v * 3;
              const x = transforms[matrix + a] * triangles[p];
              const y = transforms[matrix + a + 4] * triangles[p + 1];
              const z = transforms[matrix + a + 8] * triangles[p + 2];
              const w = transforms[matrix + a + 12];
              const value = x + y + z + w;
              // Four f32 products/additions: gamma(7) bounds either fused or separate evaluation.
              const error =
                (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(w)) *
                ((7 * 2 ** -24) / (1 - 7 * 2 ** -24));
              bounds[at + a] = Math.min(bounds[at + a], value);
              bounds[at + a + 3] = Math.max(bounds[at + a + 3], value);
              errors[t * 3 + a] = Math.max(errors[t * 3 + a], error);
            }
        }
      }
    for (let node = nodeChanged.length - 1; node >= 0; node--) {
      let dirty = false;
      for (let slot = 0; slot < 4; slot++) {
        const at = node * 12 + slot * 3,
          flags = nodeChildren[at + 1];
        if (flags >>> 24 === 0) continue;
        const count = (flags >>> 16) & 255,
          first = nodeChildren[at + 2];
        if (count === 0) dirty ||= !!nodeChanged[first];
        else for (let t = first; t < first + count; t++) dirty ||= !!changed[t];
      }
      if (!dirty) continue;
      nodeChanged[node] = 1;
      grow(node);
      const base = node * 6;
      nodeBounds.fill(Infinity, base, base + 3);
      nodeBounds.fill(-Infinity, base + 3, base + 6);
      for (let slot = 0; slot < 4; slot++) {
        const at = node * 12 + slot * 3,
          flags = nodeChildren[at + 1];
        if (flags >>> 24 === 0) continue;
        const count = (flags >>> 16) & 255,
          first = nodeChildren[at + 2];
        for (let a = 0; a < 6; a++) {
          let bound = a < 3 ? Infinity : -Infinity;
          if (count === 0) bound = nodeBounds[first * 6 + a];
          else
            for (let t = first; t < first + count; t++)
              bound =
                a < 3
                  ? Math.min(bound, bounds[t * 6 + a] - errors[t * 3 + a])
                  : Math.max(bound, bounds[t * 6 + a] + errors[t * 3 + a - 3]);
          boxes[slot * 6 + a] = bound;
          nodeBounds[base + a] = outward(
            a < 3 ? Math.min(nodeBounds[base + a], bound) : Math.max(nodeBounds[base + a], bound),
            a >= 3,
          );
        }
      }
      for (let slot = 0; slot < 4; slot++) {
        const at = node * 12 + slot * 3;
        if (nodeChildren[at + 1] >>> 24 === 0) continue;
        let low = 0,
          high = nodeChildren[at + 1] & 0xffff0000;
        for (let a = 0; a < 6; a++) {
          const axis = a % 3,
            min = nodeBounds[base + axis];
          const span = nodeBounds[base + axis + 3] - min;
          // One additional quantization unit covers shader subtraction and reconstruction rounding.
          const unit = span > 0 ? ((boxes[slot * 6 + a] - min) / span) * 255 : a < 3 ? 0 : 255;
          const q = Math.max(0, Math.min(255, a < 3 ? Math.floor(unit) - 1 : Math.ceil(unit) + 1));
          if (a < 4) low |= q << (a * 8);
          else high |= q << ((a - 4) * 8);
        }
        nodeChildren[at] = low;
        nodeChildren[at + 1] = high;
        if (((high >>> 16) & 255) === 0) grow(nodeChildren[at + 2]);
      }
    }
    // Tight geometry extent drives the existing cascade planner, not padded traversal boxes.
    extent.fill(0);
    if (bounds.length)
      for (let a = 0; a < 6; a++) {
        let value = a < 3 ? Infinity : -Infinity;
        for (let t = 0; t < triangleGroups.length; t++)
          value = a < 3 ? Math.min(value, bounds[t * 6 + a]) : Math.max(value, bounds[t * 6 + a]);
        extent[a] = value;
      }
  };
  return Object.assign(refit, {
    /** World bounds of each triangle over all its owners, six per triangle, and the moved ones. */
    boxes: bounds,
    changed,
    /** Nodes a ray may visit beyond the built tree's, since the first motion. */
    grownNodes: () => grownNodes,
    bytes:
      errors.byteLength +
      bounds.byteLength +
      changed.byteLength +
      nodeChanged.byteLength +
      grown.byteLength +
      boxes.byteLength +
      starts.byteLength +
      slots.byteLength,
  });
}
