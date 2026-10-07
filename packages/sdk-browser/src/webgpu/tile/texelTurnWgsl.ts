import { MATERIAL_MIP_FORMAT } from '../../texture/mips.ts'

// The kernel that turns raw texels on the GPU (`texelTurn.ts`).

/** Texels one workgroup turns, along a row. */
export const TEXEL_TURN_WORKGROUP = 64
/** The turns a host texture asks, as bits. */
export const TEXEL_FLIP = 1,
  TEXEL_PREMULTIPLY = 2

/** One invocation per texel of a band of `rows` source rows: its colour times its alpha rounded to
 *  the nearest byte under `TEXEL_PREMULTIPLY` (`(c·a + 127) / 255`, the rounding of `c·a / 255`,
 *  never a half), stored at level 0's row `first + y`, reversed in the band under `TEXEL_FLIP`. */
export const TEXEL_TURN_WGSL = /* wgsl */ `
struct Turn { width: u32, rows: u32, first: u32, flags: u32 }
@group(0) @binding(0) var<uniform> turn: Turn;
@group(0) @binding(1) var<storage, read> source: array<u32>;
@group(0) @binding(2) var turned: texture_storage_2d<${MATERIAL_MIP_FORMAT}, write>;
fn times(c: u32, a: u32) -> u32 { return (c * a + 127u) / 255u; }
@compute @workgroup_size(${TEXEL_TURN_WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;
  if (x >= turn.width || y >= turn.rows) { return; }
  var t = source[y * turn.width + x];
  if ((turn.flags & ${TEXEL_PREMULTIPLY}u) != 0u) {
    let a = t >> 24u;
    t = times(t & 255u, a) | (times((t >> 8u) & 255u, a) << 8u) | (times((t >> 16u) & 255u, a) << 16u) | (a << 24u);
  }
  let to = select(turn.first + y, turn.first + turn.rows - 1u - y, (turn.flags & ${TEXEL_FLIP}u) != 0u);
  textureStore(turned, vec2u(x, to), unpack4x8unorm(t));
}`
