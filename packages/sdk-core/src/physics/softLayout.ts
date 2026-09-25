/**
 * The soft bodies' word layouts, shared with `packages/physics-jolt-wasm/src/soft.cpp`; part of
 * `PHYSICS_LAYOUT_VERSION` (`layout.ts`), which a change here bumps.
 */

/**
 * Words of SOFT before its vertices: `op, engine id, px, py, pz, qx, qy, qz, qw, sx, sy, sz,
 * friction, restitution, gravityScale, linearDamping, stretch, bend, pressure, vertexCount,
 * indexCount, byteCount` — the body's place, turn and scale in the world, its matter, its
 * compliances (m/N; `Infinity` is no constraint) and its gauge pressure at rest (Pa, 0 none). No
 * flags word: a soft body is never a sensor nor CCD, and the contact events it wants follow in a
 * FLAGS command. Then per vertex `SOFT_VERTEX_WORDS`: `x, y, z, mass` in the geometry's own frame,
 * a mass of 0 held in place (a pin); then `indexCount` triangle corners. A body with no triangle
 * is a rope: each vertex joined to the next. A cooked body (`physics.json`) carries neither: its
 * `byteCount` bytes follow, its `SoftBodySharedSettings` in Jolt's binary state padded to whole
 * words, already scaled and holding its compliances. A soft body is removed as any body (REMOVE).
 */
export const SOFT_WORDS = 22;
export const SOFT_VERTEX_WORDS = 4;
/**
 * The soft bodies after a step (`jolt_soft`): per body that moved since it was last written, `engine
 * id, vertex count`, then per vertex `x, y, z` in the geometry's own frame.
 */
export const SOFT_STATE_WORDS = 2;
