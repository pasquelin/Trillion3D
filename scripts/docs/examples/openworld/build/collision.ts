/**
 * One collision mesh per solid prop (#332), simplified to the walker's scale: every triangle but
 * the `card/` sheets (leaves, sails) welded where positions coincide and cut into pieces (the
 * triangles that share vertices); a piece smaller than the walker's capsule radius is dropped,
 * the others collapsed by edge (meshoptimizer) within that same radius. Collapses keep the
 * surviving vertices where they were, so a floor keeps its height.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  scaleOf,
  type CollisionMesh,
} from '../../../../../site/examples/kit/openworld/play/collision.ts';
import { FOOT } from '../../../../../site/examples/kit/openworld/play/sim/foot.ts';
import type { Instance, PropMesh } from '../plan/contract.ts';

await MeshoptSimplifier.ready;

/** Props the walker goes through: plants. */
const walkedThrough = (id: string) => /^(tree|bush)-/.test(id);

/** Every solid triangle of the prop, positions welded where they are bit for bit equal. */
function welded(mesh: PropMesh) {
  const slots = new Map<string, number>(),
    positions: number[] = [],
    indices: number[] = [];
  for (const part of mesh.parts) {
    if (part.surface.name.startsWith('card/')) continue;
    const p = part.positions;
    for (const i of part.indices) {
      const key = `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`;
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = positions.length / 3;
        slots.set(key, slot);
        positions.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      }
      indices.push(slot);
    }
  }
  return { positions, indices };
}

/** The triangles of each piece, pieces in the order of their first triangle. */
function pieces(vertexCount: number, indices: readonly number[]) {
  const parent = Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const root = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  for (let t = 0; t < indices.length; t += 3)
    for (const k of [1, 2]) parent[root(indices[t + k])] = root(indices[t]);
  const byRoot = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const r = root(indices[t]);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return [...byRoot.values()];
}

/** A piece on vertices of its own, numbered in first use. */
function compact(positions: readonly number[], indices: readonly number[]): CollisionMesh {
  const used = new Map<number, number>(),
    out: number[] = [];
  const local = indices.map((v) => {
    if (!used.has(v)) {
      used.set(v, used.size);
      out.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    return used.get(v)!;
  });
  return { positions: Float32Array.from(out), indices: Uint32Array.from(local) };
}

/** The low and high corners of the vertices `indices` uses. */
export function bounds(positions: Float32Array, indices: Uint32Array, origin = false) {
  const low = origin ? [0, 0, 0] : [Infinity, Infinity, Infinity],
    high = origin ? [0, 0, 0] : [-Infinity, -Infinity, -Infinity];
  for (const v of indices)
    for (let a = 0; a < 3; a++) {
      low[a] = Math.min(low[a], positions[v * 3 + a]);
      high[a] = Math.max(high[a], positions[v * 3 + a]);
    }
  return [low, high] as const;
}

/**
 * Triangles collapsed by edge within `error` metres. meshoptimizer 0.18's wrapper hands the
 * simplifier three times the vertices it copies, the rest being whatever its heap last held:
 * a throwaway call of the same shape zeroes that tail first, so the result depends on the mesh
 * alone, and the error is scaled by the extent the simplifier then sees, origin included.
 */
function collapse({ positions, indices }: CollisionMesh, error: number) {
  const blank = [new Uint32Array(indices.length), new Float32Array(positions.length * 3)] as const;
  MeshoptSimplifier.simplify(blank[0], blank[1], 3, 0, 1);
  const [low, high] = bounds(positions, indices, true),
    extent = Math.max(...high.map((h, a) => h - low[a]));
  return MeshoptSimplifier.simplify(indices, positions, 3, 0, error / extent)[0];
}

/** A piece collapsed within `cell`, the error halved until no side of it moves by more than
 * `cell`: a small closed piece never collapses to nothing. */
function simplify(piece: CollisionMesh, cell: number) {
  const [low, high] = bounds(piece.positions, piece.indices);
  for (let error = cell; error > 0; error /= 2) {
    const collapsed = collapse(piece, error);
    if (!collapsed.length) continue;
    const [l, h] = bounds(piece.positions, collapsed);
    if ([0, 1, 2].every((a) => Math.max(Math.abs(l[a] - low[a]), Math.abs(h[a] - high[a])) <= cell))
      return compact([...piece.positions], [...collapsed]);
  }
  return piece;
}

type Box = ReturnType<typeof bounds>;

/** A piece less than `cell` across. */
const speck = ([low, high]: Box, cell: number) =>
  Math.max(...high.map((h, a) => h - low[a])) < cell;

/**
 * The prop's collision mesh, or undefined when nothing of it stops the walker. `grown` is the
 * largest factor a placement scales it by: the walker's radius is that much smaller in the
 * prop's own frame.
 */
export function collisionMesh(mesh: PropMesh, grown = 1): CollisionMesh | undefined {
  if (walkedThrough(mesh.id)) return undefined;
  const cell = FOOT.radius / grown,
    { positions, indices } = welded(mesh),
    out: number[] = [],
    triangles: number[] = [];
  const all = pieces(positions.length / 3, indices).map((list) => {
    const piece = compact(positions, list);
    return { piece, box: bounds(piece.positions, piece.indices) };
  });
  for (const { piece, box } of all) {
    if (speck(box, cell)) continue;
    const kept = simplify(piece, cell),
      base = out.length / 3;
    out.push(...kept.positions);
    for (const v of kept.indices) triangles.push(v + base);
  }
  if (!triangles.length) return undefined;
  return { positions: Float32Array.from(out), indices: Uint32Array.from(triangles) };
}

/** The collision mesh of every solid placed prop, by id, in the meshes' order. */
export function collisionMeshes(meshes: readonly PropMesh[], instances: readonly Instance[]) {
  const grown = new Map<string, number>();
  for (const { prop, scale } of instances)
    grown.set(prop, Math.max(grown.get(prop) ?? 0, ...scaleOf(scale).map(Math.abs)));
  const byId = new Map<string, CollisionMesh>();
  for (const mesh of meshes) {
    const collision = grown.has(mesh.id) ? collisionMesh(mesh, grown.get(mesh.id)) : undefined;
    if (collision) byId.set(mesh.id, collision);
  }
  return byId;
}
