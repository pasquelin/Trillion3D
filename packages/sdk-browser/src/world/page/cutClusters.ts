/** The clusters of the runtime cutter (`runtimeCut.ts`) and the texture spans that set its grid. */
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';

/** A cluster holds at most this many triangles and vertices: the page format's cluster, the one
 *  the compiler cuts (`docs/FORMAT.md`). */
const CLUSTER_TRIANGLES = 128,
  CLUSTER_VERTICES = 255;

/**
 * The squared diagonal of the least box that holds `CLUSTER_TRIANGLES` triangles of total area
 * `CLUSTER_TRIANGLES · area / count` side by side, the longest of them `longest` across: a square
 * of that area, or a rectangle `longest` long when one triangle outreaches the square's side: the
 * extent a spatially compact cluster of these triangles reaches.
 */
function compactSquared(count: number, area: number, longest: number) {
  const held = (CLUSTER_TRIANGLES * area) / count,
    side = Math.max(longest, Math.sqrt(held));
  return side ? side * side + (held / side) ** 2 : 0;
}

/** A run of consecutive triangles of `positions`: its box, its triangles' area, their longest edge. */
function createRun(positions: Float32Array) {
  const box = new Float64Array(6),
    grown = new Float64Array(6);
  let count = 0,
    area = 0,
    longest = 0,
    /** The last triangle measured: its area and longest edge, the run's box grown by it. */
    nextArea = 0,
    nextLongest = 0;
  const p = (v: number, axis: number) => positions[v * 3 + axis];
  const edge = (u: number, v: number) =>
    hypot3(p(v, 0) - p(u, 0), p(v, 1) - p(u, 1), p(v, 2) - p(u, 2));
  const grow = (v: number) => boxExpandByPoint(grown, 0, p(v, 0), p(v, 1), p(v, 2));
  const measure = (a: number, b: number, c: number) => {
    const ux = p(b, 0) - p(a, 0),
      uy = p(b, 1) - p(a, 1),
      uz = p(b, 2) - p(a, 2),
      vx = p(c, 0) - p(a, 0),
      vy = p(c, 1) - p(a, 1),
      vz = p(c, 2) - p(a, 2);
    nextArea = hypot3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    nextLongest = Math.max(edge(a, b), edge(b, c), edge(c, a));
    grown.set(box);
    grow(a);
    grow(b);
    grow(c);
  };
  return {
    /**
     * Adds triangle `(a, b, c)` to the run while the run reaches no farther than a compact cluster
     * of its triangles — its box's diagonal within that cluster's (`compactSquared`) —, else, or
     * when `fresh`, as the first of a new run. True when it starts a new run.
     */
    add(a: number, b: number, c: number, fresh: boolean) {
      if (!fresh) {
        measure(a, b, c);
        const diagonal =
          (grown[3] - grown[0]) ** 2 + (grown[4] - grown[1]) ** 2 + (grown[5] - grown[2]) ** 2;
        fresh =
          diagonal > compactSquared(count + 1, area + nextArea, Math.max(longest, nextLongest));
      }
      if (fresh) {
        count = area = longest = 0;
        boxEmpty(box, 0);
        measure(a, b, c);
      }
      box.set(grown);
      count++;
      area += nextArea;
      longest = Math.max(longest, nextLongest);
      return fresh;
    },
  };
}

/** The widest range of either texture coordinate over the corners of one cluster; with no
 *  `indices`, a range runs over the vertices themselves. */
export function widestUvSpan(
  uvs: Float32Array,
  indices: Uint32Array | null,
  ranges: [number, number][],
) {
  let widest = 0;
  for (const [start, end] of ranges)
    for (let c = 0; c < 2; c++) {
      let lo = Infinity,
        hi = -Infinity;
      for (let i = start; i < end; i++) {
        const value = uvs[(indices ? indices[i] : i) * 2 + c];
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      widest = Math.max(widest, hi - lo);
    }
  return widest;
}

/** The widest range of either texture coordinate over every vertex: the span the compiler sets a
 *  primitive's texture grid by (`primitive_uv_exponent`). */
export const primitiveUvSpan = (uvs: Float32Array) =>
  widestUvSpan(uvs, null, [[0, uvs.length / 2]]);

/** The index ranges a compiled primitive's own clusters take, `ends[k]` the end of cluster `k`. */
export const givenClusters = (ends: Uint32Array): [number, number][] =>
  Array.from(ends, (end, k) => [k ? ends[k - 1] : 0, end]);

/**
 * Index ranges of consecutive triangles, each within the cluster's triangle and vertex bounds.
 * A vertex is marked with the number of the cluster that last took it: no set per triangle.
 *
 * With `compactAt`, the positions of a primitive whose triangles keep their order — a blended one,
 * its order its paint order —, a range also ends where its next triangle would take its box past
 * the diagonal of a compact cluster of its triangles (`compactSquared`): cut in order, its pages
 * never reach farther than compact ones. A shadow cull bounds a cluster by the sphere of its box
 * (`webgpu/shadow/spheres.ts`) and draws it whole into every page that sphere covers, so a run
 * that strays — 128 triangles along a grid's row, a strip 64 cells long — is drawn into pages by
 * the square of its length, at every level its pages fall in.
 */
export function* clusters(
  indices: Uint32Array,
  vertexCount: number,
  compactAt?: Float32Array,
): Generator<[number, number]> {
  const taken = new Uint32Array(vertexCount),
    run = compactAt && createRun(compactAt);
  let start = 0,
    cluster = 1,
    held = 0;
  const take = (v: number) => {
    if (taken[v] === cluster) return;
    taken[v] = cluster;
    held++;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2];
    const fresh =
      Number(taken[a] !== cluster) +
      Number(taken[b] !== cluster && b !== a) +
      Number(taken[c] !== cluster && c !== a && c !== b);
    const full = (t - start) / 3 >= CLUSTER_TRIANGLES,
      ends = full || held + fresh > CLUSTER_VERTICES;
    // A compact run also ends where its triangle would take it too far (`add`).
    if ((run ? run.add(a, b, c, ends || t === start) : ends) && t > start) {
      yield [start, t];
      start = t;
      cluster++;
      held = 0;
    }
    take(a);
    take(b);
    take(c);
  }
  if (start < indices.length) yield [start, indices.length];
}
