import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * THE ADAPTIVE VOLUMETRIC SHADOW MAP'S WORDS. A texel of the map is a list of samples along its ray, a sample being a distance `x` and the
 * luminance of the transmittance there (`tau`); the list is read two ways.
 *
 * - While it is built, a linked list in a fixed run of `maxSampleCount` entries a texel: an entry is two words, the distance as a float in
 *   the first and, in the second, the transmittance as a half float in the high half and the indices of the entry before and after (eight
 *   bits each, 0xFF for none) in the low.
 * - Once compressed, an indirection entry a texel (four words: the offset of its samples with their count, and the first and last
 *   distance) and, in an atlas, its samples, two levels: every fourth sample first, then the samples themselves offset by one, each a word of
 *   a distance in 16 bits over the texel's range and the transmittance as a half float.
 */
export const AVSM_WGSL = wgslBlock(
  'AVSM_WGSL',
  [],
  `const AVSM_NULL_PTR=0xFFu;
const AVSM_INVALID_PIXEL_OFFSET=0x3FFFFFFu;
const AVSM_MAX_HALF=65504.0;
struct AvsmSample{x:f32,tau:f32,}
struct AvsmIndirection{pixelOffset:u32,sampleCount:i32,beginX:f32,endX:f32,}

fn avsmSample(x:f32,tau:f32)->AvsmSample{return AvsmSample(x,tau);}
fn avsmLinearIndex(face:u32,pixel:vec2u,res:vec2i)->u32{return face*u32(res.x*res.y)+pixel.y*u32(res.x)+pixel.x;}
fn avsmAlign4(v:i32)->i32{return (v+3)&~3;}
fn avsmTopLevelCount(count:i32)->i32{return avsmAlign4(count)>>2u;}

/** A distance as a 16-bit fixed point over the texel's range; a range of none gives zero. */
fn avsmPackX(x:f32,ind:AvsmIndirection)->u32{
 let extent=ind.endX-ind.beginX;
 if(extent==0.0){return 0u;}
 return u32(clamp((x-ind.beginX)/extent,0.0,1.0)*AVSM_MAX_HALF);
}
fn avsmUnpackX(quantized:u32,ind:AvsmIndirection)->f32{
 return clamp(f32(quantized)/AVSM_MAX_HALF,0.0,1.0)*(ind.endX-ind.beginX)+ind.beginX;
}
fn avsmPackSample(s:AvsmSample,ind:AvsmIndirection)->u32{
 return avsmPackX(s.x,ind)|(pack2x16float(vec2f(0.0,s.tau))&0xFFFF0000u);
}
fn avsmUnpackSample(packed:u32,ind:AvsmIndirection)->AvsmSample{
 return AvsmSample(avsmUnpackX(packed&0xFFFFu,ind),unpack2x16float(packed).y);
}

fn avsmListSample(entry:vec2u)->AvsmSample{
 return AvsmSample(bitcast<f32>(entry.x),unpack2x16float(entry.y).y);
}
fn avsmListSetSample(entry:vec2u,s:AvsmSample)->vec2u{
 return vec2u(bitcast<u32>(s.x),(entry.y&0xFFFFu)|(pack2x16float(vec2f(0.0,s.tau))&0xFFFF0000u));
}
fn avsmListPrev(entry:vec2u)->u32{return (entry.y>>8u)&AVSM_NULL_PTR;}
fn avsmListNext(entry:vec2u)->u32{return entry.y&AVSM_NULL_PTR;}
fn avsmListSetPrev(entry:vec2u,link:u32)->vec2u{
 return vec2u(entry.x,(entry.y&0xFFFF00FFu)|((link&AVSM_NULL_PTR)<<8u));
}
fn avsmListSetNext(entry:vec2u,link:u32)->vec2u{
 return vec2u(entry.x,(entry.y&0xFFFFFF00u)|(link&AVSM_NULL_PTR));
}

fn avsmPackIndirection(ind:AvsmIndirection)->vec4u{
 return vec4u(((ind.pixelOffset&AVSM_INVALID_PIXEL_OFFSET)<<6u)|(u32(ind.sampleCount)&0x3Fu),bitcast<u32>(ind.beginX),bitcast<u32>(ind.endX),0u);
}
fn avsmUnpackIndirection(packed:vec4u)->AvsmIndirection{
 return AvsmIndirection((packed.x>>6u)&AVSM_INVALID_PIXEL_OFFSET,i32(packed.x&0x3Fu),bitcast<f32>(packed.y),bitcast<f32>(packed.z));
}`,
)
