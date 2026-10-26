import { linearToSrgb } from '../../../../math/src/wgsl/color.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

// The mip chains' kernels: the reduction of a material level and the turn of raw texels
// (`mipBatch.ts`).

/** A material level's uniform block: the source level's extent. */
const LEVEL_WGSL = wgslBlock(
  'LEVEL_WGSL',
  [],
  ` struct Level{extent:vec4u}
 @group(0) @binding(1) var<uniform> level:Level;`,
)

/**
 * One level of a material chain from the one above, one thread a texel, the whole chain one
 * compute pass (`generateMaterialMips`). Every channel is the plain mean of the four texels: a
 * colour level is read decoded through its sRGB view and averaged in linear light; an sRGB format
 * has no storage binding, so `srgb` encodes it again (`linearToSrgb`) into the `rgba8unorm`
 * storage view. Alpha is averaged like the colours, no texel weighing another: the rule the
 * compiler bakes (`packages/asset-compiler-rust/src/texture/reduce.rs`, `halve`).
 *
 * Level 0 of a host texture's raw texels that ask a turn (#362) is the batch's first step, on the
 * same layout (`turnLevel`): the texels as `writeTexture` stored them, in an `rgba8unorm` texture
 * of their own bound as `source`, stored into level 0 — the row read from the bottom under `FLIP`
 * (the picture's last row at v = 0), the colour times the alpha rounded to the nearest byte under
 * `PREMULTIPLY` (`(c·a + 127) / 255`, never a half) — before any level reads level 0. Bytes in and
 * out exactly: a byte loaded is `b / 255`, `pack4x8unorm` gives `b` back.
 */
export const MATERIAL_MIP_WGSL = wgslProgram(
  `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(2) var written:texture_storage_2d<rgba8unorm,write>;
 override srgb:bool;
 @compute @workgroup_size(8,8) fn reduceLevel(@builtin(global_invocation_id) id:vec3u){
  if(any(id.xy>=textureDimensions(written))){return;}
  let p=vec2i(id.xy)*2;let hi=vec2i(level.extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  let mean=(s0+s1+s2+s3)*0.25;
  var rgb=mean.rgb;
  if(srgb){rgb=linearToSrgb(rgb);}
  textureStore(written,vec2i(id.xy),vec4f(rgb,mean.w));
 }
 override FLIP:bool=false;
 override PREMULTIPLY:bool=false;
 fn turnTimes(c:u32,a:u32)->u32{return (c*a+127u)/255u;}
 @compute @workgroup_size(8,8) fn turnLevel(@builtin(global_invocation_id) id:vec3u){
  let size=textureDimensions(written);
  if(any(id.xy>=size)){return;}
  var t=pack4x8unorm(textureLoad(source,vec2i(vec2u(id.x,select(id.y,size.y-1u-id.y,FLIP))),0));
  if(PREMULTIPLY){
   let a=t>>24u;
   t=turnTimes(byteOf(t,0u),a)|(turnTimes(byteOf(t,1u),a)<<8u)|(turnTimes(byteOf(t,2u),a)<<16u)|(a<<24u);
  }
  textureStore(written,vec2i(id.xy),unpack4x8unorm(t));
 }`,
  [LEVEL_WGSL, linearToSrgb, byteOf],
)
