import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { RENDER_CURVE_PARAMS_WGSL } from './paramsWgsl.ts'
import { RENDER_CURVE_BIN_TILE_SIZE } from './renderCurveMath.ts'

/** The invocations of the tile depth's group: a quarter of a bin tile's pixels, each invocation reading four (a device's group holds 256 at least). */
const TILE_LANES = 256
const PIXELS_PER_LANE = (RENDER_CURVE_BIN_TILE_SIZE * RENDER_CURVE_BIN_TILE_SIZE) / TILE_LANES

/** The format of the tile depth: the nearest and the furthest depth of a bin tile, as the bits of their floats. */
export const RENDER_CURVE_TILE_DEPTH_FORMAT: GPUTextureFormat = 'rg32uint'

/**
 * THE SCENE'S DEPTH PER BIN TILE: a group a tile of `RENDER_CURVE_BIN_TILE_SIZE` pixels a side, which reads every pixel of the
 * tile inside `resolution` and writes the least and the greatest of their depths (reverse-Z: the furthest and the nearest) as the
 * bits of the floats, which order as whole numbers, into the tile's texel. Group 0: the shared block (binding 0), the scene's depth
 * (1), the tile depth written (2).
 */
export const RENDER_CURVE_SCENE_TILE_DEPTH_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var sceneDepth:texture_depth_2d;
@group(0) @binding(2) var tileDepth:texture_storage_2d<${RENDER_CURVE_TILE_DEPTH_FORMAT},write>;
var<workgroup> furthest:atomic<u32>;
var<workgroup> nearest:atomic<u32>;
@compute @workgroup_size(${TILE_LANES})
fn sceneTileDepth(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) tile:vec3u){
 if(lane==0u){
  atomicStore(&furthest,0xFFFFFFFFu);
  atomicStore(&nearest,0u);
 }
 workgroupBarrier();
 for(var k=0u;k<${PIXELS_PER_LANE}u;k++){
  let at=lane+k*${TILE_LANES}u;
  let pixel=vec2u(at%${RENDER_CURVE_BIN_TILE_SIZE}u,at/${RENDER_CURVE_BIN_TILE_SIZE}u)+tile.xy*${RENDER_CURVE_BIN_TILE_SIZE}u;
  if(all(pixel<curve.resolution)){
   let depth=bitcast<u32>(textureLoad(sceneDepth,vec2i(pixel),0));
   atomicMin(&furthest,depth);
   atomicMax(&nearest,depth);
  }
 }
 workgroupBarrier();
 if(lane==0u){textureStore(tileDepth,vec2i(tile.xy),vec4u(atomicLoad(&furthest),atomicLoad(&nearest),0u,0u));}
}`,
  [RENDER_CURVE_PARAMS_WGSL],
)
