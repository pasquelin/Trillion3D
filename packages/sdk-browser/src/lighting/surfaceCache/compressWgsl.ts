import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { WORKGROUP_THREADS, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { unpackLight } from '../../gpu/core/smallFloatWgsl.ts'
import { CAPTURE_COMMON, CAPTURE_TEXELS } from './copyWgsl.ts'
import { BLOCK } from './layout.ts'

/**
 * THE ENCODERS OF THE COMPRESSED ATLAS: the blocks of 4 × 4 texels the albedo, the normal and the
 * emission are kept in (BC7, BC5, BC6H), made on the GPU from the texels a page ends as
 * (`finalTexel`, `copyWgsl.ts`) and written to the staging buffer (`stagingOf`, `layout.ts`), whence a
 * copy puts them in the atlas (`compress.ts`). Each is the cheap encoder of its format:
 * - BC5 (two channels), each channel a block of 8 values between its least and greatest, in 8 bits;
 * - BC6H, the one-subset mode of 10-bit endpoints between the block's least and greatest half floats,
 *   the 4-bit indices spaced along the line between them;
 * - BC7, the one-subset mode of 7-bit endpoints, a least-squares fit of the endpoints to the indices
 *   of the first guess, then the indices again; the endpoints' parity bits and the alpha are zero.
 * A block whose first texel's index comes out over seven is written with its endpoints swapped, as the
 * first index of a colour block has one bit less. A block of one value has a span of nothing: its
 * indices are zero.
 *
 * A thread encodes one block: a workgroup of `WORKGROUP_THREADS` threads is a quarter as many tiles of 8 × 8 texels, four blocks each.
 * The three layers are three entry points, dispatched one after the other over the same lists. The
 * clear program writes the block of a cleared texel (black) in every block of the staging buffer.
 */

/** The entry points of the encoding program, one for each layer of `BLOCK_LAYERS`. */
export const ENCODE_ENTRIES = ['encodeAlbedo', 'encodeNormal', 'encodeEmission'] as const

/** The tiles a workgroup of the encoding program works on: `WORKGROUP_THREADS` threads, four blocks to a tile. */
export const TILES_PER_GROUP = WORKGROUP_THREADS / 4

/** The threads of a workgroup of the program that clears the staging buffer: a square. */
export const CLEAR_GROUP = 8

/** The indices of an 8-value block of one channel: for the 16 values of `values` between `lo` and `hi`
 *  (the least and the greatest), the value's place in the 8 steps from `hi` to `lo`, as the format
 *  counts them (0 the greatest, 1 the least, 2 to 7 between), 3 bits each, in 48 bits: two words. */
const bcAlphaIndices = wgslFn(
  'bcAlphaIndices',
  [],
  `fn bcAlphaIndices(values:ptr<function,array<f32,16>>,lo:f32,hi:f32)->vec2u{
 let scale=7.0/(lo-hi);
 let bias=-scale*hi;
 var words=vec2u(0u);
 for(var i=0u;i<16u;i++){
  var index=u32(clamp(round((*values)[i]*scale+bias),0.0,7.0));
  if(index==7u){index=1u;}else if(index>0u){index+=1u;}
  if(i<5u){words.x|=index<<(16u+i*3u);}
  else if(i==5u){words.x|=index<<31u;words.y|=index>>1u;}
  else{words.y|=index<<(i*3u-16u);}
 }
 return words;
}`,
)

/** The BC5 block of two channels of 16 values: each channel's range in 8 bits, the greater first, then
 *  its indices. */
const bc5Block = wgslFn(
  'bc5Block',
  [bcAlphaIndices],
  `fn bc5Block(u:ptr<function,array<f32,16>>,v:ptr<function,array<f32,16>>)->vec4u{
 var uLo=(*u)[0];var uHi=uLo;var vLo=(*v)[0];var vHi=vLo;
 for(var i=1u;i<16u;i++){
  uLo=min(uLo,(*u)[i]);uHi=max(uHi,(*u)[i]);
  vLo=min(vLo,(*v)[i]);vHi=max(vHi,(*v)[i]);
 }
 let uBytes=vec2u(round(vec2f(uLo,uHi)*255.0));
 let vBytes=vec2u(round(vec2f(vLo,vHi)*255.0));
 var uWords=vec2u(0u);var vWords=vec2u(0u);
 if(uBytes.x<uBytes.y){uWords=bcAlphaIndices(u,uLo,uHi);}
 if(vBytes.x<vBytes.y){vWords=bcAlphaIndices(v,vLo,vHi);}
 return vec4u((uBytes.x<<8u)|uBytes.y|uWords.x,uWords.y,(vBytes.x<<8u)|vBytes.y|vWords.x,vWords.y);
}`,
)

/** The 16 indices of a colour block as its last two words: 4 bits each, the first 3 bits, from bit 1 of the
 *  third word of the block. */
const bcPackIndices = wgslFn(
  'bcPackIndices',
  [],
  `fn bcPackIndices(indices:ptr<function,array<u32,16>>)->vec2u{
 var low=(*indices)[0]<<1u;
 var high=0u;
 for(var i=1u;i<8u;i++){low|=(*indices)[i]<<(4u*i);}
 for(var i=8u;i<16u;i++){high|=(*indices)[i]<<(4u*(i-8u));}
 return vec2u(low,high);
}`,
)

/** A number as the bits of the half float it rounds to, as a float: what the BC6H encoder spaces its
 *  indices by. Held to the half's greatest and its least. */
const bcHalfBits = wgslFn(
  'bcHalfBits',
  [],
  `fn bcHalfBits(x:f32)->f32{return f32(pack2x16float(vec2f(clamp(x,0.0,65504.0),0.0))&0xffffu);}`,
)

/** The index of the colour `c` along the line of direction `dir` between the ends at `p0` and `p1`,
 *  16 steps, as BC6H counts them; a line of no span puts everything at the first. */
const bc6Index = wgslFn(
  'bc6Index',
  [bcHalfBits],
  `fn bc6Index(c:vec3f,dir:vec3f,p0:f32,p1:f32)->u32{
 let span=p1-p0;
 var t=0.0;
 if(span!=0.0){t=saturate((bcHalfBits(dot(c,dir))-p0)/span);}
 return u32(clamp(t*14.93333+0.03333+0.5,0.0,15.0));
}`,
)

/** The BC6H block of 16 colours: the 10-bit endpoints are the block's least and greatest as half floats
 *  scaled to 10 bits, the indices 4 bits along the line between them. */
const bc6Block = wgslFn(
  'bc6Block',
  [bcHalfBits, bc6Index, bcPackIndices],
  `fn bc6Block(texels:ptr<function,array<vec3f,16>>)->vec4u{
 var lo=(*texels)[0];var hi=lo;
 for(var i=1u;i<16u;i++){lo=min(lo,(*texels)[i]);hi=max(hi,(*texels)[i]);}
 var dir=hi-lo;
 let total=dir.x+dir.y+dir.z;
 dir=select(vec3f(0.0),dir/total,total>0.0);
 var end0=vec3u(vec3f(bcHalfBits(lo.x),bcHalfBits(lo.y),bcHalfBits(lo.z))*1024.0/31744.0);
 var end1=vec3u(vec3f(bcHalfBits(hi.x),bcHalfBits(hi.y),bcHalfBits(hi.z))*1024.0/31744.0);
 var p0=bcHalfBits(dot(lo,dir));var p1=bcHalfBits(dot(hi,dir));
 if(bc6Index((*texels)[0],dir,p0,p1)>7u){
  let swapPos=p0;p0=p1;p1=swapPos;
  let swapEnd=end0;end0=end1;end1=swapEnd;
 }
 var indices:array<u32,16>;
 for(var i=0u;i<16u;i++){indices[i]=bc6Index((*texels)[i],dir,p0,p1);}
 let words=bcPackIndices(&indices);
 var block=vec4u(0u);
 block.x=3u|(end0.x<<5u)|(end0.y<<15u)|(end0.z<<25u);
 block.y=(end0.z>>7u)|(end1.x<<3u)|(end1.y<<13u)|(end1.z<<23u);
 block.z=(end1.z>>9u)|words.x;
 block.w=words.y;
 return block;
}`,
)

/** The index of the colour `c` along the line of direction `dir` between the ends at `p0` and `p1`,
 *  16 steps, as BC7 counts them; a line of no span puts everything at the first. */
const bc7Index = wgslFn(
  'bc7Index',
  [],
  `fn bc7Index(c:vec3f,dir:vec3f,p0:f32,p1:f32)->u32{
 let span=p1-p0;
 var t=0.0;
 if(span!=0.0){t=saturate((dot(c,dir)-p0)/span);}
 return u32(clamp(t*14.93333+0.03333+0.5,0.0,15.0));
}`,
)

/** The BC7 block of 16 colours in [0, 1]: the least and greatest colour, moved to the ends that fit the
 *  indices they give by least squares (kept where the fit is ill-posed), 7 bits a channel, and the
 *  indices 4 bits along the line between the ends. */
const bc7Block = wgslFn(
  'bc7Block',
  [bc7Index, bcPackIndices],
  `fn bc7Block(texels:ptr<function,array<vec3f,16>>)->vec4u{
 var lo=(*texels)[0];var hi=lo;
 for(var i=1u;i<16u;i++){lo=min(lo,(*texels)[i]);hi=max(hi,(*texels)[i]);}
 {
  let first=hi-lo;
  let q0=dot(lo,first);let q1=dot(hi,first);
  var alphaSum=vec3f(0.0);var betaSum=vec3f(0.0);
  var alphaBeta=0.0;var alphaSq=0.0;var betaSq=0.0;
  for(var i=0u;i<16u;i++){
   let beta=saturate(f32(bc7Index((*texels)[i],first,q0,q1))/15.0);
   let alpha=1.0-beta;
   alphaSum+=alpha*(*texels)[i];betaSum+=beta*(*texels)[i];
   alphaBeta+=alpha*beta;alphaSq+=alpha*alpha;betaSq+=beta*beta;
  }
  let det=alphaSq*betaSq-alphaBeta*alphaBeta;
  if(abs(det)>0.1){
   let inverse=1.0/det;
   lo=saturate(inverse*(alphaSum*betaSq-betaSum*alphaBeta));
   hi=saturate(inverse*(betaSum*alphaSq-alphaSum*alphaBeta));
  }
 }
 let dir=hi-lo;
 var end0=vec3u(lo*255.0)>>vec3u(1u);
 var end1=vec3u(hi*255.0)>>vec3u(1u);
 var p0=dot(lo,dir);var p1=dot(hi,dir);
 if(bc7Index((*texels)[0],dir,p0,p1)>7u){
  let swapPos=p0;p0=p1;p1=swapPos;
  let swapEnd=end0;end0=end1;end1=swapEnd;
 }
 var indices:array<u32,16>;
 for(var i=0u;i<16u;i++){indices[i]=bc7Index((*texels)[i],dir,p0,p1);}
 let words=bcPackIndices(&indices);
 var block=vec4u(0u);
 block.x=0x40u|(end0.x<<7u)|(end1.x<<14u)|(end0.y<<21u)|(end1.y<<28u);
 block.y=(end1.y>>4u)|(end0.z<<3u)|(end1.z<<10u);
 block.z=words.x;
 block.w=words.y;
 return block;
}`,
)

/** The encoders' entry points: the staging buffer, the block a thread is, the three layers' sections. */
const ENCODE_BODY = `@group(0) @binding(7) var<storage,read_write> blocks:array<vec4u>;
/** The tile and the block of it a thread of a workgroup is: four blocks of 4 × 4 texels to an
 *  8 × 8 tile, a quarter as many tiles as threads to a workgroup. */
fn blockWork(group:vec3u,n:vec3u,lane:u32)->Work{
 let sub=lane&3u;
 return workAt((group.x+group.y*n.x)*TILES_PER_GROUP+(lane>>2u),vec2u(sub&1u,sub>>1u)*BLOCK_TEXELS);
}
/** The texel \`i\` of the block of \`w\` (row by row), as the page ends with it. */
fn blockTexel(w:Work,i:u32)->EndTexel{
 var texel=w;
 texel.local=w.local+vec2u(i&3u,i>>2u);
 texel.capture=w.rect.xy+texel.local;
 return finalTexel(texel);
}
/** The place of the block of \`w\` in the section of layer \`layer\` of the staging buffer. */
fn blockAt(w:Work,layer:u32)->u32{
 let across=params.captureSide/BLOCK_TEXELS;
 let block=w.capture/vec2u(BLOCK_TEXELS);
 return layer*across*across+block.y*across+block.x;
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn encodeAlbedo(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let w=blockWork(group,n,lane);
 if(!w.valid){return;}
 var texels:array<vec3f,16>;
 for(var i=0u;i<16u;i++){texels[i]=blockTexel(w,i).albedo;}
 blocks[blockAt(w,0u)]=bc7Block(&texels);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn encodeNormal(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let w=blockWork(group,n,lane);
 if(!w.valid){return;}
 var x:array<f32,16>;var y:array<f32,16>;
 for(var i=0u;i<16u;i++){let normal=blockTexel(w,i).normal;x[i]=normal.x;y[i]=normal.y;}
 blocks[blockAt(w,1u)]=bc5Block(&x,&y);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn encodeEmission(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let w=blockWork(group,n,lane);
 if(!w.valid){return;}
 var texels:array<vec3f,16>;
 for(var i=0u;i<16u;i++){texels[i]=unpackLight(blockTexel(w,i).emissive);}
 blocks[blockAt(w,2u)]=bc6Block(&texels);
}
`

/** The program that encodes the blocks of the pages of an image into the staging buffer (binding 7),
 *  from the capture atlas (bindings 3 to 6, `CAPTURE_TEXELS`). */
export const ENCODE_WGSL = wgslProgram(
  `${wgslConsts({ BLOCK_TEXELS: BLOCK.texels, TILES_PER_GROUP })}
${ENCODE_BODY}`,
  [CAPTURE_TEXELS, WORKGROUP_THREADS_WGSL, unpackLight, bc5Block, bc6Block, bc7Block],
)

/** The program that writes the block of a cleared texel — black in the three layers — in every block of
 *  the staging buffer (binding 7), a thread to a block of the three sections. */
export const CLEAR_BLOCKS_WGSL = wgslProgram(
  `${wgslConsts({ BLOCK_TEXELS: BLOCK.texels })}
@group(0) @binding(7) var<storage,read_write> blocks:array<vec4u>;
@compute @workgroup_size(${CLEAR_GROUP},${CLEAR_GROUP})
fn clearBlocks(@builtin(global_invocation_id) id:vec3u){
 let across=params.captureSide/BLOCK_TEXELS;
 if(any(id.xy>=vec2u(across))){return;}
 let at=id.y*across+id.x;
 var texels:array<vec3f,16>;
 var x:array<f32,16>;
 var y:array<f32,16>;
 for(var i=0u;i<16u;i++){texels[i]=vec3f(0.0);x[i]=0.0;y[i]=0.0;}
 blocks[at]=bc7Block(&texels);
 blocks[at+across*across]=bc5Block(&x,&y);
 blocks[at+2u*across*across]=bc6Block(&texels);
}
`,
  [CAPTURE_COMMON, bc5Block, bc6Block, bc7Block],
)
