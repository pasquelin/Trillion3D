export const SOFT_VERTEX_WORDS = 4
/** Words of SOFT before its vertices: its last, `carries`, the engine id of the page's soft body it
 *  replaces at another scale (`NO_INDEX` for none), whose vertices' places and velocities it goes
 *  on from, scaled (`physics-jolt-wasm/src/softPlacement.h`), then the filter the soft body is made
 *  with (`FILTER_WORDS`, `layout.ts`). */
export const SOFT_WORDS = 24
/**
 * The soft bodies after a step (`jolt_soft`): per body that moved since it was last written, `engine
 * id, vertex count`, then per vertex `x, y, z` in the geometry's own frame.
 */
export const SOFT_STATE_WORDS = 2
