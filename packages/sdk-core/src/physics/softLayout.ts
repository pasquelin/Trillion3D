export const SOFT_VERTEX_WORDS = 4
/** Words of SOFT before its vertices. */
export const SOFT_WORDS = 22
/**
 * The soft bodies after a step (`jolt_soft`): per body that moved since it was last written, `engine
 * id, vertex count`, then per vertex `x, y, z` in the geometry's own frame.
 */
export const SOFT_STATE_WORDS = 2
