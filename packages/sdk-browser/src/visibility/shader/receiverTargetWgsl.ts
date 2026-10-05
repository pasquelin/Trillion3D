/**
 * THE SHADOW RECEIVER TARGET: the resolve, which has the pixel's triangle decoded already, writes
 * its receiver once (`shadowReceiver`, `receiverOffsetWgsl.ts`: the Phong offset and the
 * triangle's plane), and the virtual shadow maps' projection reads it back here instead of
 * decoding the triangle again from the visibility buffer for every pixel.
 *
 * One texel a pixel, `rg32uint` (8 bytes), 64 bits: the plane in octahedral form (two 10-bit
 * halves, ≤ 4.2e-3 rad); the offset in a shared exponent (5 bits, 2^-26 to 2^4 m) and three signed
 * 13-bit mantissas — within 1/4095 (2.4e-4) of its largest component (5 µm on a 2 cm offset). A
 * zero exponent field is no receiver. `receiverOffsetReaders.test.ts` holds the round trip to
 * these bounds.
 */
export const RECEIVER_TARGET_FORMAT: GPUTextureFormat = 'rg32uint';
export const RECEIVER_TARGET_BYTES = 8;

/** The plane's octahedral form: the resolve encodes (`receiverOct`), the reader decodes
 *  (`receiverUnoct`); each side holds only its own half. */
const OCT_ENCODE_WGSL = `fn receiverOct(n:vec3f)->vec2f{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 return select(p,(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)),n.z<0.0);
}`;
const OCT_DECODE_WGSL = `fn receiverUnoct(p:vec2f)->vec3f{
 var n=vec3f(p,1.0-abs(p.x)-abs(p.y));
 let k=saturate(-n.z);
 n=vec3f(n.xy+select(vec2f(k),vec2f(-k),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}`;

/** The resolve's write: `storeReceiver` with the offset and the (unnormalised) plane; a zero plane
 *  is no receiver. */
export const receiverStoreWgsl = (binding: number) => `
@group(0) @binding(${binding}) var receiverOutput:texture_storage_2d<${RECEIVER_TARGET_FORMAT},write>;
${OCT_ENCODE_WGSL}
fn storeReceiver(pos:vec2f,offset:vec3f,plane:vec3f){
 if(!all(vec2u(pos)<textureDimensions(receiverOutput))){return;}
 if(dot(plane,plane)<=0.0){textureStore(receiverOutput,vec2i(pos),vec4u(0u));return;}
 let q=vec2u(round(saturate(receiverOct(plane)*0.5+0.5)*1023.0));
 let m=max(max(abs(offset.x),abs(offset.y)),abs(offset.z));
 var e=-26;
 if(m>0.0){e=clamp(i32(ceil(log2(m))),-26,4);if(m>exp2(f32(e))&&e<4){e+=1;}}
 let k=vec3u(vec3i(round(clamp(offset/exp2(f32(e)),vec3f(-1.0),vec3f(1.0))*4095.0))+vec3i(4096));
 let x=q.x|(q.y<<10u)|(u32(e+27)<<20u)|((k.x&127u)<<25u);
 let y=(k.x>>7u)|(k.y<<6u)|(k.z<<19u);
 textureStore(receiverOutput,vec2i(pos),vec4u(x,y,0u,0u));
}`;

/** The reader's `shadowReceiver(pixel)`, the decode's own result (`receiverOffsetWgsl.ts`): the
 *  pixel's texel (`shadowReceiverTexel`) decoded (`shadowReceiverOf`), each for a reader that loads
 *  the texel ahead of its decode. */
export const receiverTargetReadWgsl = (group: number, binding: number) => `
@group(${group}) @binding(${binding}) var receiverTarget:texture_2d<u32>;
struct ShadowReceiver{offset:vec3f,plane:vec3f,}
${OCT_DECODE_WGSL}
fn shadowReceiverTexel(pixel:vec2i)->vec2u{return textureLoad(receiverTarget,pixel,0).xy;}
fn shadowReceiver(pixel:vec2f)->ShadowReceiver{return shadowReceiverOf(shadowReceiverTexel(vec2i(pixel)));}
fn shadowReceiverOf(t:vec2u)->ShadowReceiver{
 let field=(t.x>>20u)&31u;
 if(field==0u){return ShadowReceiver(vec3f(0.0),vec3f(0.0));}
 let k=vec3u((t.x>>25u)|((t.y&63u)<<7u),(t.y>>6u)&8191u,t.y>>19u);
 let offset=vec3f(vec3i(k)-vec3i(4096))/4095.0*exp2(f32(i32(field)-27));
 let plane=receiverUnoct(vec2f(f32(t.x&1023u),f32((t.x>>10u)&1023u))/1023.0*2.0-1.0);
 return ShadowReceiver(offset,plane);
}`;
