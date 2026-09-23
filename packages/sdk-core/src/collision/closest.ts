/**
 * CLOSEST POINTS between a segment and a triangle, the query a capsule is built on: a capsule
 * is the set of points within `radius` of a segment, so it overlaps a triangle exactly when the
 * segment comes closer than `radius` to it.
 *
 * The closest pair of a segment and a triangle is one of three things: the point where the
 * segment pierces the triangle (distance zero), an end of the segment against the triangle, or
 * the segment against one of the triangle's three edges. Each is solved in closed form and the
 * nearest kept. A triangle is read from a flat list, nine numbers from `at`; every result is
 * written into caller-owned arrays, so a query allocates nothing.
 */

type Numbers = ArrayLike<number>;

const edge = new Float64Array(6),
  onEdge = new Float64Array(3),
  tail = new Float64Array(3),
  candidate = new Float64Array(6),
  normal = new Float64Array(3);

/** The parameter in `[0, 1]` of the point of segment `(a, b)` closest to `p`, `a` for a point segment. */
function segmentParameter(p: Numbers, a: Numbers, aAt: number, b: Numbers, bAt: number) {
  const dx = b[bAt] - a[aAt],
    dy = b[bAt + 1] - a[aAt + 1],
    dz = b[bAt + 2] - a[aAt + 2];
  const length = dx * dx + dy * dy + dz * dz;
  if (length === 0) return 0;
  const t = ((p[0] - a[aAt]) * dx + (p[1] - a[aAt + 1]) * dy + (p[2] - a[aAt + 2]) * dz) / length;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The point of triangle `v[at..at+9]` closest to `p`, written to `out`; returns the squared
 * distance. Inside its three edges the plane's projection is the answer; outside, the nearest
 * point of the nearest edge. A degenerate triangle is its edges alone.
 */
export function closestOnTriangle(out: Float64Array, p: Numbers, v: Numbers, at: number) {
  const area = triangleNormal(normal, v, at);
  if (area > 0) {
    const h =
      ((p[0] - v[at]) * normal[0] +
        (p[1] - v[at + 1]) * normal[1] +
        (p[2] - v[at + 2]) * normal[2]) /
      area;
    for (let k = 0; k < 3; k++) out[k] = p[k] - h * normal[k];
    if (insideTriangle(out[0], out[1], out[2], v, at, normal)) return h * h * area;
  }
  let best = Infinity;
  for (let e = 0; e < 3; e++) {
    const from = at + 3 * e,
      to = at + 3 * ((e + 1) % 3);
    const t = segmentParameter(p, v, from, v, to);
    for (let c = 0; c < 3; c++) candidate[c] = v[from + c] + t * (v[to + c] - v[from + c]);
    const distance = squaredGap(p, 0, candidate, 0);
    if (distance < best) {
      best = distance;
      out.set(candidate.subarray(0, 3));
    }
  }
  return best;
}

/** The triangle's unnormalised normal, `(b - a) × (c - a)`, into `out`; returns its squared
 *  length (four times the squared area), zero for a degenerate triangle. */
export function triangleNormal(out: Float64Array, v: Numbers, at: number) {
  const ux = v[at + 3] - v[at],
    uy = v[at + 4] - v[at + 1],
    uz = v[at + 5] - v[at + 2],
    wx = v[at + 6] - v[at],
    wy = v[at + 7] - v[at + 1],
    wz = v[at + 8] - v[at + 2];
  out[0] = uy * wz - uz * wy;
  out[1] = uz * wx - ux * wz;
  out[2] = ux * wy - uy * wx;
  return out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
}

/** Whether a point of the triangle's plane lies on the inner side of all three edges, the
 *  sides being read against the triangle's normal `n` as `triangleNormal` wrote it. */
export function insideTriangle(
  x: number,
  y: number,
  z: number,
  v: Numbers,
  at: number,
  n: Numbers,
) {
  for (let e = 0; e < 3; e++) {
    const from = at + 3 * e,
      to = at + 3 * ((e + 1) % 3);
    const ex = v[to] - v[from],
      ey = v[to + 1] - v[from + 1],
      ez = v[to + 2] - v[from + 2];
    const px = x - v[from],
      py = y - v[from + 1],
      pz = z - v[from + 2];
    const turn =
      (ey * pz - ez * py) * n[0] + (ez * px - ex * pz) * n[1] + (ex * py - ey * px) * n[2];
    if (turn < 0) return false;
  }
  return true;
}

function squaredGap(a: Numbers, aAt: number, b: Numbers, bAt: number) {
  const dx = a[aAt] - b[bAt],
    dy = a[aAt + 1] - b[bAt + 1],
    dz = a[aAt + 2] - b[bAt + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The closest points of segments `(p, q)` and `(r, s)` — six numbers each, start then end —
 * written to `out[0..3]` (on the first) and `out[3..6]` (on the second); returns the squared
 * distance. The unconstrained optimum is clamped to the first segment, the second's parameter
 * follows, and is itself clamped with the first recomputed once: the textbook closed form.
 */
export function closestBetweenSegments(out: Float64Array, first: Numbers, second: Numbers) {
  const d1x = first[3] - first[0],
    d1y = first[4] - first[1],
    d1z = first[5] - first[2];
  const d2x = second[3] - second[0],
    d2y = second[4] - second[1],
    d2z = second[5] - second[2];
  const rx = first[0] - second[0],
    ry = first[1] - second[1],
    rz = first[2] - second[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z,
    e = d2x * d2x + d2y * d2y + d2z * d2z,
    f = d2x * rx + d2y * ry + d2z * rz,
    c = d1x * rx + d1y * ry + d1z * rz,
    b = d1x * d2x + d1y * d2y + d1z * d2z;
  const clamp = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
  let s = 0,
    t = 0;
  if (a === 0 && e === 0) s = t = 0;
  else if (a === 0) t = clamp(f / e);
  else if (e === 0) s = clamp(-c / a);
  else {
    const denominator = a * e - b * b;
    s = denominator > 0 ? clamp((b * f - c * e) / denominator) : 0;
    t = (b * s + f) / e;
    if (t < 0) [t, s] = [0, clamp(-c / a)];
    else if (t > 1) [t, s] = [1, clamp((b - c) / a)];
  }
  for (let k = 0; k < 3; k++) {
    out[k] = first[k] + s * (first[3 + k] - first[k]);
    out[3 + k] = second[k] + t * (second[3 + k] - second[k]);
  }
  return squaredGap(out, 0, out, 3);
}

/**
 * The closest points of segment `segment` (six numbers) and triangle `v[at..at+9]`: `out[0..3]`
 * on the segment, `out[3..6]` on the triangle; returns the squared distance, zero when the
 * segment pierces the triangle.
 */
export function closestSegmentTriangle(
  out: Float64Array,
  segment: Numbers,
  v: Numbers,
  at: number,
) {
  if (pierces(out, segment, v, at)) return 0;
  let best = Infinity;
  for (let end = 0; end < 6; end += 3) {
    for (let k = 0; k < 3; k++) tail[k] = segment[end + k];
    const distance = closestOnTriangle(onEdge, tail, v, at);
    if (distance < best) {
      best = distance;
      for (let k = 0; k < 3; k++) [out[k], out[3 + k]] = [tail[k], onEdge[k]];
    }
  }
  for (let e = 0; e < 3; e++) {
    const from = at + 3 * e,
      to = at + 3 * ((e + 1) % 3);
    for (let k = 0; k < 3; k++) [edge[k], edge[3 + k]] = [v[from + k], v[to + k]];
    const distance = closestBetweenSegments(candidate, segment, edge);
    if (distance < best) {
      best = distance;
      out.set(candidate);
    }
  }
  return best;
}

/** Whether the segment passes through the triangle: its ends on opposite sides of the plane,
 *  the crossing inside the edges. The crossing is then written to both halves of `out`. */
function pierces(out: Float64Array, segment: Numbers, v: Numbers, at: number) {
  if (triangleNormal(normal, v, at) === 0) return false;
  const side = (k: number) =>
    (segment[k] - v[at]) * normal[0] +
    (segment[k + 1] - v[at + 1]) * normal[1] +
    (segment[k + 2] - v[at + 2]) * normal[2];
  const d0 = side(0),
    d1 = side(3);
  if (d0 * d1 > 0 || d0 === d1) return false;
  const t = d0 / (d0 - d1);
  for (let k = 0; k < 3; k++) out[k] = out[3 + k] = segment[k] + t * (segment[3 + k] - segment[k]);
  return insideTriangle(out[0], out[1], out[2], v, at, normal);
}
