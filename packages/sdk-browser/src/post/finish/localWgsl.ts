import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { FINISH, GRID_DEPTH, GRID_TILE } from './finishLayout.ts'
import { FINISH_WGSL } from './finishWgsl.ts'

/** Pixels a thread of the grid's workgroup reads on a side: the workgroup is 8 × 8 threads, each a
 *  tile of `GRID_TILE / 8` pixels square, read two by two along each axis. */
const LANES = 8
const PAIR = 2
/** The fixed point the grid sums in: 9 fractional bits in each 16-bit half of a word, which a
 *  thread's 64 pixels fill to 2^15 at the most. */
const FIXED = 512

/**
 * THE BILATERAL GRID OF THE LOCAL EXPOSURE, one workgroup a tile of `GRID_TILE` × `GRID_TILE`
 * half-size pixels. Each of its 64 threads reads the pixels of its own 8 × 8 block — a block read
 * as 2 × 2 quads, a quad past the image's last column or row left out — and places each pixel's
 * luminance, read as the exposure reads it, in the grid's 32 bands of log luminance:
 * between the two bands it lies between, its weight shared by how near each is, and its position
 * in the histogram times that weight. A thread sums in fixed point, a word holding both, in
 * columns of its own; the first 32 threads then add each band's columns up and store
 * the band's sum of log luminance and its sum of weights, each a 64th, in the grid's cell of the
 * tile at that depth: halves a `rgba16float` holds, whose ratio the finishing reads.
 */
export const GRID_WGSL = wgslProgram(
  `
${FINISH.wgsl}
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var<uniform> finish:Finish;
@group(0) @binding(2) var cells:texture_storage_3d<rgba16float,write>;
var<workgroup> bands:array<u32,${GRID_DEPTH * LANES * LANES}>;
fn packed(weight:f32,placed:f32)->u32{
 return ((u32(weight*${FIXED}.0)&0xffffu)<<16u)|(u32(max(placed,0.0)*${FIXED}.0)&0xffffu);
}
@compute @workgroup_size(${LANES},${LANES})
fn grid(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let size=vec2u(textureDimensions(scene));
 let origin=tile.xy*${GRID_TILE}u;
 for(var y=0u;y<${GRID_TILE}u;y+=${LANES * PAIR}u){
  for(var x=0u;x<${GRID_TILE}u;x+=${LANES * PAIR}u){
   let quad=origin+vec2u(x,y)+at.xy*${PAIR}u;
   if(all(quad<size-vec2u(1u))){
    for(var q=0u;q<4u;q++){
     let pixel=textureLoad(scene,vec2i(quad+vec2u(q&1u,q>>1u)),0);
     let light=max(dot(pixel.rgb,finish.weights.xyz),finish.weights.w);
     let stop=log2(light)*finish.histogram.x+finish.histogram.y;
     let place=saturate(stop)*${GRID_DEPTH - 1}.0;
     let low=min(u32(place),${GRID_DEPTH - 1}u);
     let high=min(low+1u,${GRID_DEPTH - 1}u);
     let share=fract(place);
     let lowAt=low*${LANES * LANES}u+lane;
     let highAt=high*${LANES * LANES}u+lane;
     bands[lowAt]=bands[lowAt]+packed(1.0-share,stop*(1.0-share));
     bands[highAt]=bands[highAt]+packed(share,stop*share);
    }
   }
  }
 }
 workgroupBarrier();
 if(lane<${GRID_DEPTH}u){
  var weights=0.0;
  var logs=0.0;
  for(var i=0u;i<${LANES * LANES}u;i++){
   let word=bands[lane*${LANES * LANES}u+i];
   let weight=f32(word>>16u)/${FIXED}.0;
   let placed=f32(word&0xffffu)/${FIXED}.0;
   weights+=weight;
   logs+=(placed-weight*finish.histogram.y)/finish.histogram.x;
  }
  textureStore(cells,vec3u(tile.xy,lane),vec4f(logs/${GRID_TILE}.0,weights/${GRID_TILE}.0,0.0,0.0));
 }
}`,
  [],
)

/**
 * The log2 luminance of a level of the scene's chain, one texel a pixel, as the exposure reads
 * luminance: what the local exposure blurs into its second base layer. Written to one channel.
 */
export const LOG_LIGHT_WGSL = wgslProgram(
  `
@group(0) @binding(0) var scene:texture_2d<f32>;
@fragment fn logLight(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let c=textureLoad(scene,vec2i(pixel.xy),0);
 return vec4f(lightLog(c.rgb),0.0,0.0,0.0);
}`,
  [FINISH_WGSL, FULLSCREEN_VERTEX],
)
