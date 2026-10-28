/**
 * THE MAPS IN ONE BUFFER, for the passes that apply the lights. A lit pass has no sampled texture to spare, so the maps of every
 * light are packed into one read-only storage buffer of words (`beerShadowReadWgsl.ts` reads it):
 *   word 0 the count R of shadow slices, words 1..R the word offset of the block of each light slice (0: none), then the blocks:
 *   the 12 words of the light's `HvShadow`, then its texels in the strip's order (a row of faces a texel high), two words a texel
 *   in 16-bit precision (the halves of T0 and T1, then of Tau0 and Tau1) and four in 32-bit.
 */
export const PACK_WGSL = `
@group(0) @binding(0) var strip:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> packed:array<u32>;
@group(0) @binding(2) var<uniform> job:vec4u;
@compute @workgroup_size(8,8,1)
fn packBeerMap(@builtin(global_invocation_id) id:vec3u){
 let width=job.y*job.z;
 if(id.x>=width||id.y>=job.y){return;}
 let t=textureLoad(strip,vec2i(id.xy),0);
 let index=id.y*width+id.x;
 if(job.w==0u){
  packed[job.x+index*2u]=pack2x16float(t.xy);
  packed[job.x+index*2u+1u]=pack2x16float(t.zw);
 }else{
  let o=job.x+index*4u;
  packed[o]=bitcast<u32>(t.x);
  packed[o+1u]=bitcast<u32>(t.y);
  packed[o+2u]=bitcast<u32>(t.z);
  packed[o+3u]=bitcast<u32>(t.w);
 }
}`
