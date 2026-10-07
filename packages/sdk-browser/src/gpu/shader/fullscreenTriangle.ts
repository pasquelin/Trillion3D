/**
 * The full-screen triangle: corners (−1, −1), (3, −1) and (−1, 3) from the vertex index alone, no
 * buffer and no attribute, covering the viewport. One home for every program that draws it: each
 * axis is an expression of the vertex index `i`, so a program writes the corner as it needs it —
 * a position, a depth of its own, a coordinate it derives.
 */
export const FULLSCREEN_X_WGSL = 'f32(i32(i&1u)*4-1)'
export const FULLSCREEN_Y_WGSL = 'f32(i32(i>>1u)*4-1)'
export const FULLSCREEN_XY_WGSL = `${FULLSCREEN_X_WGSL},${FULLSCREEN_Y_WGSL}`
