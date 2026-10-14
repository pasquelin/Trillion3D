import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { STORE_BITS, STORE_CELL } from './runtimeLayout.ts'

/** The largest depth or distance a half keeps, in metres: a surface farther keeps no key
 *  (`rtCellPut`), so that no history finds it, and a ray longer keeps this length. */
const KEY_CEILING = 65000

/**
 * A CELL OF THE RUN-TIME PROXY'S STORE (`runtimeLayout.ts`), its three words read and written here
 * alone: in set `base` (the set's first layer), at pixel `at`. `RtCell` holds them as they lie — the
 * colour's word and the confidence's sixteen bits, which a cell kept for another pixel copies whole
 * (`rtCellPut`), so that a kept answer is the bits it was —, and the key decoded: the surface's normal
 * (an octahedral code, four bits an axis, the axes and the diagonals exact), its linear depth under the
 * view that wrote the cell, and the distance its ray met a surface at, zero where it met none. A cell
 * whose stamp is zero holds no answer: a hole.
 */
export const runtimeCellWgsl = (group: number, store: number) =>
  wgslBlock(
    `runtimeCellWgsl(${group}, ${store})`,
    [],
    `
${wgslConsts({
  RT_CONFIDENCE_MAX: 2 ** STORE_BITS.confidence - 1,
  RT_NORMAL_SHIFT: STORE_BITS.normal,
  RT_STAMP_SHIFT: STORE_BITS.stamp,
  RT_CELL_COLOR: STORE_CELL.color,
  RT_CELL_WORD: STORE_CELL.word,
  RT_CELL_KEY: STORE_CELL.key,
})}
const RT_KEY_CEILING:f32=${wgslF32(KEY_CEILING)};
@group(${group}) @binding(${store}) var rtStore:texture_storage_2d_array<r32uint,read_write>;
struct RtCell{color:u32,share:u32,stamp:u32,normal:vec3f,depth:f32,distance:f32,}
/** A radiance on a shared exponent, nine bits a channel (rgb9e5): the pixel's colour in one word. */
fn rtPackShared(c:vec3f)->u32{
 let v=clamp(c,vec3f(0.0),vec3f(65408.0));
 let top=max(v.x,max(v.y,v.z));
 var exponent=max(-16.0,floor(log2(max(top,1e-30))))+16.0;
 var step=exp2(exponent-24.0);
 if(floor(top/step+0.5)>=512.0){exponent+=1.0;step*=2.0;}
 let m=vec3u(floor(v/step+vec3f(0.5)));
 return m.x|(m.y<<9u)|(m.z<<18u)|(u32(exponent)<<27u);
}
fn rtUnpackShared(w:u32)->vec3f{
 let m=vec3f(f32(w&511u),f32((w>>9u)&511u),f32((w>>18u)&511u));
 return m*exp2(f32(w>>27u)-24.0);
}
/** An epoch's stamp on eight bits, never zero: a pixel never answered holds none. */
fn rtStamp(epoch:u32)->u32{return epoch%255u+1u;}
/** A unit normal on eight bits: its octahedral map, fifteen steps an axis, zero one of them. */
fn rtOctEncode(n:vec3f)->u32{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 var q=p;
 if(n.z<0.0){q=vec2f((1.0-abs(p.y))*select(-1.0,1.0,p.x>=0.0),(1.0-abs(p.x))*select(-1.0,1.0,p.y>=0.0));}
 let c=vec2u(round(clamp(q*0.5+vec2f(0.5),vec2f(0.0),vec2f(1.0))*14.0));
 return c.x|(c.y<<4u);
}
fn rtOctDecode(code:u32)->vec3f{
 let p=vec2f(f32(code&15u),f32((code>>4u)&15u))/7.0-vec2f(1.0);
 let z=1.0-abs(p.x)-abs(p.y);
 let t=max(-z,0.0);
 return normalize(vec3f(p.x-select(-t,t,p.x>=0.0),p.y-select(-t,t,p.y>=0.0),z));
}
/** No answer: a hole. */
fn rtNone()->RtCell{return RtCell(0u,0u,0u,vec3f(0.0),0.0,0.0);}
fn rtCellRead(at:vec2u,base:u32)->RtCell{
 let word=textureLoad(rtStore,at,base+RT_CELL_WORD).x;
 let stamp=word>>RT_STAMP_SHIFT;
 if(stamp==0u){return rtNone();}
 let key=unpack2x16float(textureLoad(rtStore,at,base+RT_CELL_KEY).x);
 let color=textureLoad(rtStore,at,base+RT_CELL_COLOR).x;
 return RtCell(color,word&RT_CONFIDENCE_MAX,stamp,rtOctDecode((word>>RT_NORMAL_SHIFT)&255u),key.x,key.y);
}
/** A cell's words: its colour's and confidence's as they are, its key from the surface it now answers. */
fn rtCellPut(at:vec2u,base:u32,color:u32,share:u32,stamp:u32,normal:vec3f,depth:f32,distance:f32){
 var key=vec2f(0.0);
 if(depth<RT_KEY_CEILING){key=vec2f(depth,min(distance,RT_KEY_CEILING));}
 textureStore(rtStore,at,base+RT_CELL_COLOR,vec4u(color,0u,0u,0u));
 textureStore(rtStore,at,base+RT_CELL_KEY,vec4u(pack2x16float(key),0u,0u,0u));
 textureStore(rtStore,at,base+RT_CELL_WORD,vec4u(share|(rtOctEncode(normal)<<RT_NORMAL_SHIFT)|(stamp<<RT_STAMP_SHIFT),0u,0u,0u));
}
/** A ray's answer kept in a cell under \`stamp\`, for the surface of normal \`normal\` at \`depth\`. */
fn rtCellWrite(at:vec2u,base:u32,answer:RtRadiance,stamp:u32,normal:vec3f,depth:f32,distance:f32){
 let share=u32(round(clamp(answer.confidence,0.0,1.0)*f32(RT_CONFIDENCE_MAX)));
 rtCellPut(at,base,rtPackShared(answer.color*answer.confidence),share,stamp,normal,depth,distance);
}
/** A hole: the cell's stamp zero, its other words unread. */
fn rtHoleWrite(at:vec2u,base:u32){textureStore(rtStore,at,base+RT_CELL_WORD,vec4u(0u,0u,0u,0u));}
/** What a cell answers: the radiance of the share it holds, and that share. */
fn rtCellAnswer(cell:RtCell)->RtRadiance{
 let confidence=f32(cell.share)/f32(RT_CONFIDENCE_MAX);
 if(!(confidence>0.0)){return RtRadiance(vec3f(0.0),0.0);}
 return RtRadiance(rtUnpackShared(cell.color)/confidence,min(confidence,1.0));
}
`,
  )
