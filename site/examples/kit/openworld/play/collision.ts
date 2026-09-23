/**
 * The static colliders the physics streams beside the cache (#332). Each solid prop has one
 * collision mesh, `colliders/props/<id>.bin`, shared by all its placements; each tile lists its
 * placements, `colliders/<tx>_<tz>.json` as `ColliderInstance[]`. A mesh file is a 16-byte
 * header (magic `WGCM`, format version, vertex count, index count, little-endian Uint32), the
 * positions as Float32 xyz, then the triangle indices as Uint32.
 */
import type { Vec3 } from './types.ts';

/** Triangles of one prop in its own frame: positions xyz, three indices a triangle. */
export type CollisionMesh = { positions: Float32Array; indices: Uint32Array };

/** One placement of a prop's collision mesh: scaled, turned by `yaw` about +Y, then moved. */
export type ColliderInstance = { prop: string; position: Vec3; yaw: number; scale: Vec3 };

const MAGIC = 0x4d434757;
const FORMAT_VERSION = 1;
const HEADER = 4;

/** Where a prop's mesh lies, relative to the tiles' folder. */
export const collisionMeshPath = (prop: string) => `props/${prop}.bin`;

export function encodeCollisionMesh(mesh: CollisionMesh) {
  const words = new Uint32Array(HEADER + mesh.positions.length + mesh.indices.length);
  words.set([MAGIC, FORMAT_VERSION, mesh.positions.length / 3, mesh.indices.length]);
  new Float32Array(words.buffer).set(mesh.positions, HEADER);
  words.set(mesh.indices, HEADER + mesh.positions.length);
  return new Uint8Array(words.buffer);
}

/** The mesh a file holds; an unknown format or a truncated file is refused. */
export function decodeCollisionMesh(buffer: ArrayBuffer): CollisionMesh {
  const head = new Uint32Array(buffer, 0, Math.min(HEADER, buffer.byteLength >> 2));
  if (head[0] !== MAGIC || head[1] !== FORMAT_VERSION)
    throw new Error('collision mesh: unknown format');
  const [vertices, indices] = [head[2] * 3, head[3]];
  if (buffer.byteLength !== (HEADER + vertices + indices) * 4 || indices % 3)
    throw new Error('collision mesh: truncated');
  return {
    positions: new Float32Array(buffer, HEADER * 4, vertices),
    indices: new Uint32Array(buffer, (HEADER + vertices) * 4, indices),
  };
}

/** A placement's scale as three factors. */
export const scaleOf = (scale: number | Vec3 | undefined): Vec3 =>
  scale === undefined ? [1, 1, 1] : typeof scale === 'number' ? [scale, scale, scale] : scale;

/** Point `p` of the prop's frame in the world, as the placement puts it. */
export function placePoint(at: ColliderInstance, x: number, y: number, z: number): Vec3 {
  const [sx, sy, sz] = at.scale,
    cos = Math.cos(at.yaw),
    sin = Math.sin(at.yaw);
  return [
    at.position[0] + x * sx * cos + z * sz * sin,
    at.position[1] + y * sy,
    at.position[2] - x * sx * sin + z * sz * cos,
  ];
}
