/**
 * Which way a prop's closed pieces face. A piece is a set of triangles joined edge to edge
 * (vertices welded to 10 µm). It is closed when every edge is walked as often one way as the
 * other: one closed shell, or boxes that touch along an edge, each wound consistently. A closed
 * piece encloses a positive signed volume when it faces outward; a negative one faces inward and
 * vanishes under back-face culling. A piece with an unbalanced edge is an open sheet (a soffit,
 * a band, a field) whose side only its builder knows.
 */
import type { MeshPart } from '../plan/contract.ts';

export type Piece = { triangles: number; closed: boolean; volume: number };

/** Welded vertex ids of every corner of `part`. */
function weldedCorners(part: MeshPart): Uint32Array {
  const ids = new Map<string, number>(),
    corners = new Uint32Array(part.indices.length);
  for (let i = 0; i < corners.length; i++) {
    const v = part.indices[i] * 3,
      key = [0, 1, 2].map((k) => Math.round(part.positions[v + k] * 1e5)).join(',');
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    corners[i] = id;
  }
  return corners;
}

/** The signed volume the triangle `t` of `part` spans with the origin. */
function signedVolume(part: MeshPart, t: number): number {
  const x = part.positions,
    [a, b, c] = [0, 1, 2].map((k) => part.indices[t * 3 + k] * 3);
  return (
    (x[a] * (x[b + 1] * x[c + 2] - x[b + 2] * x[c + 1]) -
      x[a + 1] * (x[b] * x[c + 2] - x[b + 2] * x[c]) +
      x[a + 2] * (x[b] * x[c + 1] - x[b + 1] * x[c])) /
    6
  );
}

/** The pieces of `part`, each closed or open, with its signed volume. */
export function pieces(part: MeshPart): Piece[] {
  const corners = weldedCorners(part),
    count = corners.length / 3,
    parent = Int32Array.from({ length: count }, (_, t) => t),
    root = (t: number): number => (parent[t] === t ? t : (parent[t] = root(parent[t]))),
    // Per undirected edge: its first triangle and how many more times it is walked up than down.
    edges = new Map<number, { first: number; balance: number }>();
  for (let t = 0; t < count; t++)
    for (let k = 0; k < 3; k++) {
      const from = corners[t * 3 + k],
        to = corners[t * 3 + ((k + 1) % 3)],
        key = Math.min(from, to) * 2 ** 32 + Math.max(from, to),
        edge = edges.get(key);
      if (edge) parent[root(t)] = root(edge.first);
      const walk = edge ?? { first: t, balance: 0 };
      walk.balance += from < to ? 1 : -1;
      edges.set(key, walk);
    }
  const byRoot = new Map<number, Piece>();
  for (let t = 0; t < count; t++) {
    const piece = byRoot.get(root(t)) ?? { triangles: 0, closed: true, volume: 0 };
    byRoot.set(root(t), piece);
    piece.triangles++;
    piece.volume += signedVolume(part, t);
  }
  for (const edge of edges.values()) if (edge.balance) byRoot.get(root(edge.first))!.closed = false;
  return [...byRoot.values()];
}

/** Triangles of `part` in closed pieces that face inward. */
export const inwardClosed = (part: MeshPart): number =>
  pieces(part)
    .filter((piece) => piece.closed && piece.volume < 0)
    .reduce((sum, piece) => sum + piece.triangles, 0);
