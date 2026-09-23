/**
 * A right-triangulated irregular network over a tile's (2^k + 1)² height grid (#332), after
 * Evans, Kirkpatrick and Townsend, "Right-Triangulated Irregular Networks" (Algorithmica, 2001).
 * The square is split along a diagonal, then every triangle in two at the midpoint of its
 * hypotenuse, as long as that midpoint's error exceeds a threshold. A vertex's error is the
 * height the mesh would miss there, raised to at least its children's, so splitting any vertex
 * splits its ancestors first and the mesh never holds a crack.
 */

/** The shared shape of the hierarchy for one grid size: which vertex depends on which. */
export type Hierarchy = {
  size: number;
  /** Vertices that split a hypotenuse, finest first: the order errors propagate in. */
  order: Int32Array;
  /** The two ends of each vertex's hypotenuse. */
  ends: Int32Array;
  /** Children of each vertex (up to four leg midpoints), CSR by `childStart`. */
  childStart: Int32Array;
  children: Int32Array;
};

/**
 * Walks the triangles of the subdivision from the two halves of the square down: `a`–`b` the
 * hypotenuse, `c` the right angle, `m` the hypotenuse's midpoint (-1 on the finest triangles).
 * The walk goes into a triangle's two halves only when `visit` returns true.
 */
function walk(
  size: number,
  visit: (a: number, b: number, c: number, m: number, depth: number) => boolean,
) {
  const last = size - 1;
  const step = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    depth: number,
  ) => {
    const a = az * size + ax,
      b = bz * size + bx,
      c = cz * size + cx;
    if ((ax + bx) % 2 || (az + bz) % 2) {
      visit(a, b, c, -1, depth);
      return;
    }
    const mx = (ax + bx) / 2,
      mz = (az + bz) / 2;
    if (!visit(a, b, c, mz * size + mx, depth)) return;
    step(ax, az, cx, cz, mx, mz, depth + 1);
    step(cx, cz, bx, bz, mx, mz, depth + 1);
  };
  step(0, 0, last, last, last, 0, 0);
  step(last, last, 0, 0, 0, last, 0);
}

export function hierarchy(size: number): Hierarchy {
  const count = size * size,
    depthOf = new Int32Array(count).fill(-1),
    ends = new Int32Array(count * 2).fill(-1),
    kids: number[][] = Array.from({ length: count }, () => []);
  walk(size, (a, b, c, m, depth) => {
    if (m < 0) return false;
    depthOf[m] = depth;
    [ends[m * 2], ends[m * 2 + 1]] = [a, b];
    for (const [p, q] of [
      [a, c],
      [c, b],
    ]) {
      const px = p % size,
        pz = (p - px) / size,
        qx = q % size,
        qz = (q - qx) / size;
      if ((px + qx) % 2 === 0 && (pz + qz) % 2 === 0) {
        const child = ((pz + qz) / 2) * size + (px + qx) / 2;
        if (!kids[m].includes(child)) kids[m].push(child);
      }
    }
    return true;
  });
  const order = Int32Array.from(
    [...depthOf.keys()]
      .filter((m) => depthOf[m] >= 0)
      .sort((p, q) => depthOf[q] - depthOf[p] || p - q),
  );
  const childStart = new Int32Array(count + 1);
  for (let m = 0; m < count; m++) childStart[m + 1] = childStart[m] + kids[m].length;
  return { size, order, ends, childStart, children: Int32Array.from(kids.flat()) };
}

/**
 * Each vertex's error: the height it adds over its hypotenuse, times its weight, raised to its
 * children's. `null` heights mean "no own error" (only propagate what `errors` already holds).
 */
export function propagate(
  shape: Hierarchy,
  errors: Float32Array,
  height: ((vertex: number) => number) | null,
  weight?: (vertex: number) => number,
) {
  const { order, ends, childStart, children } = shape;
  for (let k = 0; k < order.length; k++) {
    const m = order[k];
    let error = errors[m];
    if (height && weight) {
      const own =
        Math.abs((height(ends[m * 2]) + height(ends[m * 2 + 1])) / 2 - height(m)) * weight(m);
      if (own > error) error = own;
    }
    for (let c = childStart[m]; c < childStart[m + 1]; c++)
      if (errors[children[c]] > error) error = errors[children[c]];
    errors[m] = error;
  }
  return errors;
}

/** True when a vertex lies on the tile's border (one triangle splits there, not two). */
export function onBorder(size: number, vertex: number) {
  const x = vertex % size,
    z = (vertex - x) / size;
  return x === 0 || z === 0 || x === size - 1 || z === size - 1;
}

/** Triangles of the mesh at `threshold`: vertex indices, counter-clockwise seen from +Y. */
export function extract(size: number, errors: Float32Array, threshold: number): number[] {
  const out: number[] = [];
  walk(size, (a, b, c, m) => {
    if (m >= 0 && errors[m] > threshold) return true;
    // Seen from +Y with +X east and +Z south, counter-clockwise is a negative xz cross product.
    const ax = a % size,
      az = (a - ax) / size,
      bx = b % size,
      bz = (b - bx) / size,
      cx = c % size,
      cz = (c - cx) / size;
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0) out.push(a, b, c);
    else out.push(a, c, b);
    return false;
  });
  return out;
}
