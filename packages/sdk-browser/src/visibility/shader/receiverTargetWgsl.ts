import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { ndcToUvUnflipped } from '../../../../math/src/wgsl/projection.ts'
import { unitToSigned2 } from '../../../../math/src/wgsl/reals.ts'
import { pow2FromExponent } from '../../../../math/src/wgsl/integer.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import {
  SURFACE_RECEIVER_WORDS,
  SURFACE_WORDS,
  SURFACE_WORDS_FORMAT,
} from '../../materials/surface/surfaceOutputs.ts'

/**
 * THE SHADOW RECEIVER TARGET: the resolve, which has the pixel's triangle decoded already, writes
 * its receiver once (`shadowReceiverOfTriangle`, `receiverOffsetWgsl.ts`: the Phong offset and the
 * triangle's plane), and every shadow read — the virtual shadow maps' projection, the deferred
 * lighting — reads it back here, never decoding the triangle again.
 *
 * Two words a pixel (8 bytes), 64 bits, the second and third layers of the surfaces' words
 * (`SURFACE_WORDS`): the plane in octahedral form (two 10-bit halves, ≤ 4.2e-3 rad); the offset in
 * a shared exponent (5 bits, 2^-26 to 2^4 m) and three signed 13-bit mantissas — within 1/4095
 * (2.4e-4) of its largest component (5 µm on a 2 cm offset). A zero exponent field is no receiver.
 * `receiverOffsetReaders.test.ts` holds the round trip to these bounds.
 */
export const RECEIVER_TARGET_BYTES = SURFACE_RECEIVER_WORDS * texelBytesOf(SURFACE_WORDS_FORMAT)

/** The resolve's two words of a receiver (`storeReceiver`, `shadeOutputsWgsl.ts`): `receiverWords`
 *  of the offset and the (unnormalised) plane, both zero for a zero plane — no receiver. The plane
 *  goes in octahedral form (`octEncode` of the maths library), which the reader decodes
 *  (`octDecode`): each side lists only its own half. */
export const RECEIVER_WORDS_WGSL = wgslBlock(
  'RECEIVER_WORDS_WGSL',
  [octEncode, ndcToUvUnflipped, pow2FromExponent],
  `
fn receiverWords(offset:vec3f,plane:vec3f)->vec2u{
 if(dot(plane,plane)<=0.0){return vec2u(0u);}
 let q=vec2u(round(saturate(ndcToUvUnflipped(octEncode(plane)))*1023.0));
 let m=max(max(abs(offset.x),abs(offset.y)),abs(offset.z));
 var e=-26;
 if(m>0.0){e=clamp(i32(ceil(log2(m))),-26,4);if(m>pow2FromExponent(e)&&e<4){e+=1;}}
 let k=vec3u(vec3i(round(clamp(offset/pow2FromExponent(e),vec3f(-1.0),vec3f(1.0))*4095.0))+vec3i(4096));
 return vec2u(q.x|(q.y<<10u)|(u32(e+27)<<20u)|((k.x&127u)<<25u),(k.x>>7u)|(k.y<<6u)|(k.z<<19u));
}`,
)

/** A pixel's shadow receiver: its shading-point offset and its triangle's plane. The one structure
 *  of its writer (`receiverOffsetWgsl.ts`) and its reader (`receiverTargetReadWgsl`). */
export const SHADOW_RECEIVER_STRUCT_WGSL = wgslBlock(
  'SHADOW_RECEIVER_STRUCT_WGSL',
  [],
  'struct ShadowReceiver{offset:vec3f,plane:vec3f,}',
)

/** The reader's `shadowReceiver(pixel)`, the resolve's result (`receiverOffsetWgsl.ts`): the
 *  pixel's two words (`shadowReceiverTexel`) — the two layers of its view of the surfaces' words
 *  (`SurfaceBuffer.receiverView`) — decoded (`shadowReceiverOf`), each for a reader that loads the
 *  words ahead of their decode. With `within`, the name of a binding of the whole words (every
 *  layer, the flags first, the receiver's two after them) the program declares: no binding of its own. */
export const receiverTargetReadWgsl = (group: number, binding: number, within?: string) =>
  wgslBlock(
    `receiverTargetReadWgsl(${group}, ${binding}${within ? `, ${within}` : ''})`,
    [SHADOW_RECEIVER_STRUCT_WGSL, octDecode, unitToSigned2, pow2FromExponent],
    `${within ? '' : `\n@group(${group}) @binding(${binding}) var receiverTarget:texture_2d_array<u32>;`}
fn shadowReceiverTexel(pixel:vec2i)->vec2u{return vec2u(textureLoad(${within ?? 'receiverTarget'},pixel,${within ? SURFACE_WORDS.receiver : 0},0).x,textureLoad(${within ?? 'receiverTarget'},pixel,${within ? SURFACE_WORDS.receiver + 1 : 1},0).x);}
fn shadowReceiver(pixel:vec2f)->ShadowReceiver{return shadowReceiverOf(shadowReceiverTexel(vec2i(pixel)));}
fn shadowReceiverOf(t:vec2u)->ShadowReceiver{
 let field=(t.x>>20u)&31u;
 if(field==0u){return ShadowReceiver(vec3f(0.0),vec3f(0.0));}
 let k=vec3u((t.x>>25u)|((t.y&63u)<<7u),(t.y>>6u)&8191u,t.y>>19u);
 let offset=vec3f(vec3i(k)-vec3i(4096))/4095.0*pow2FromExponent(i32(field)-27);
 let plane=octDecode(unitToSigned2(vec2f(f32(t.x&1023u),f32((t.x>>10u)&1023u))/1023.0));
 return ShadowReceiver(offset,plane);
}`,
  )
