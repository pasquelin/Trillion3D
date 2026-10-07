import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import { PHYSICAL_RECORD_MASK } from '../types.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { SAMPLE_TRANSFORMED } from '../../texture/sampling.ts'
import { PHYSICAL_ROW_RECORDS } from '../../webgpu/visibility/physicalTable.ts'
import {
  LOBE_PACK_WGSL,
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_SURFACE_FLAG,
} from '../../scene/physicalLobes.ts'

/** The records' table bound at `binding` (`../../webgpu/visibility/physicalTable.ts`), and record `i`
 *  read from its three texels: the very words the table holds. */
export const physicalTableWgsl = (
  binding: number,
) => `struct PhysicalInfo{lobes:vec4f,coatNormalScale:vec2f,channels:u32,pad:u32,maps:vec4u,}
@group(0) @binding(${binding}) var physicalTable:texture_2d<u32>;
fn physicalAt(i:u32)->PhysicalInfo{
 let at=vec2u((i%${PHYSICAL_ROW_RECORDS}u)*3u,i/${PHYSICAL_ROW_RECORDS}u);
 let a=textureLoad(physicalTable,at,0);let b=textureLoad(physicalTable,at+vec2u(1u,0u),0);
 return PhysicalInfo(bitcast<vec4f>(a),bitcast<vec2f>(b.xy),b.z,b.w,textureLoad(physicalTable,at+vec2u(2u,0u),0));
}`

/**
 * The anisotropic and clear-coat lobes of a surface, from the Khronos material extension equations:
 * one implementation, which the opaque resolve (`PHYSICAL_RESOLVE_WGSL`, compiled into the
 * `HAS_PHYSICAL` class alone) and the blend pass (`../../webgpu/blend/physicalWgsl.ts`, its lobed
 * programs alone) both run. A pass sets the record (`physicalAt`) and the pixel's two UV sets —
 * each a coordinate, its screen derivatives and its deltas along two displacements `e1`, `e2` of
 * the point, which a tangent frame is built from — and `sampled`, the expression its maps' filter
 * flag is read with.
 *
 * Each map reads through the data atlas as the material's other data maps do — native size, its
 * filters, addressing and UV transform in its slot's header (`../../webgpu/tile/wgsl.ts`), its
 * tiles asked by the pixel (`physicalRequest`) — at its own UV set. Anisotropy RG is a direction,
 * B its strength; coat R and coat-roughness G are linear data; the coat normal map is bent in the
 * frame of its own coordinates, its transform included, and of the normal before the base normal
 * map, its two scales applied. The direction is rotated from the tangent the first UV set gives
 * the final normal, kept orthogonal to it.
 */
export const physicalCoreWgsl = (
  sampled: string,
) => `struct PhysicalCoord{uv:vec2f,ddx:vec2f,ddy:vec2f,d1:vec2f,d2:vec2f,}
var<private> physicalRecord:PhysicalInfo;
var<private> physicalCoord0:PhysicalCoord;
var<private> physicalCoord1:PhysicalCoord;
/** Whether map \`i\` of the record reads the second UV set (\`PHYSICAL_MAP_FIELDS\` order). */
fn physicalChannel(i:u32)->bool{return ((physicalRecord.channels>>i)&1u)!=0u;}
/** The UV set map \`i\` of the record reads. */
fn physicalCoord(i:u32)->PhysicalCoord{
 if(physicalChannel(i)){return physicalCoord1;}
 return physicalCoord0;
}
fn physicalSample(i:u32,slot:u32)->vec4f{
 let c=physicalCoord(i);
 return dataSample(slot,c.uv,c.ddx,c.ddy,${sampled});
}
/** The linear part of a data slot's UV transform, identity without one. */
fn physicalUvMatrix(slot:u32)->mat2x2f{
 if((dataSlot(slot).sampling&${SAMPLE_TRANSFORMED}u)==0u){return mat2x2f(1.0,0.0,0.0,1.0);}
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_TRANSFORM;
 return mat2x2f(bitcast<f32>(dataPages[h]),bitcast<f32>(dataPages[h+1u]),bitcast<f32>(dataPages[h+2u]),bitcast<f32>(dataPages[h+3u]));
}
/** A tile this pixel asks of map \`i\`'s texture (\`request.ts\`), or zero without that map. */
fn physicalRequest(p:RequestPick,missing:bool,i:u32)->u32{
 let slot=physicalRecord.maps[i];
 if(slot==0u){return 0u;}
 let c=physicalCoord(i);
 return dataRequestIndex(slot,c.uv,c.ddx,c.ddy,p.next,p.along,true,${sampled},missing);
}
/** The pixel's lobes: the anisotropy direction, the coat normal, the strength, the coat and its
 *  roughness after the maps — neither lobe where the strength and the coat are not above zero.
 *  \`N\` is the shading normal, \`coatBase\` the normal before the base normal map, \`screenFace\`
 *  the side the frame of \`e1\`, \`e2\` is seen from, \`coatFace\` the turn of a two-sided surface's
 *  frame (the normal map's own). */
struct PhysicalLobes{direction:vec3f,coatN:vec3f,strength:f32,coat:f32,coatRough:f32,}
fn physicalValues(N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32)->PhysicalLobes{
 let r=physicalRecord;
 var strength=r.lobes.x;var rotation=r.lobes.y;var coat=r.lobes.z;var coatRough=r.lobes.w;
 if(r.maps.x!=0u){
  let m=physicalSample(0u,r.maps.x).rgb;let d=m.rg*2.0-1.0;
  strength*=m.b;
  if(dot(d,d)>0.0){rotation+=atan2(d.y,d.x);}
 }
 // The coat and its roughness packed in one texture, as glTF writes them, read it once.
 var coatSample=vec4f(1.0);
 if(r.maps.y!=0u){coatSample=physicalSample(1u,r.maps.y);coat*=coatSample.r;}
 if(r.maps.z!=0u){
  if(r.maps.z!=r.maps.y||physicalChannel(1u)!=physicalChannel(2u)){coatSample=physicalSample(2u,r.maps.z);}
  coatRough=clamp(r.lobes.w*coatSample.g,${ROUGHNESS_FLOOR},1.0);
 }
 var direction=vec3f(0.0,0.0,1.0);
 var frame0:CotangentFrame;
 if(strength>0.0){
  let c=physicalCoord0;
  frame0=cotangentFrame(N,e1,e2,c.d1,c.d2);
  let fT=frame0.T*screenFace;let fB=frame0.B*screenFace;
  var T=fT-N*dot(N,fT);
  if(dot(T,T)<1e-12){T=cross(select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(N.z)<0.999),N);}
  T=normalize(T);var B=normalize(cross(N,T));
  if(dot(B,fB)<0.0){B=-B;}
  direction=cos(rotation)*T+sin(rotation)*B;
 }
 var coatN=coatBase;
 if(coat>0.0&&r.maps.w!=0u){
  let c=physicalCoord(3u);
  let n=physicalSample(3u,r.maps.w).xyz*2.0-1.0;
  // The anisotropy's frame where it is the coat's own: the same normal, the first UV set, no
  // transform on the map.
  var frame=frame0;
  let identity=(dataSlot(r.maps.w).sampling&${SAMPLE_TRANSFORMED}u)==0u;
  if(!(strength>0.0&&identity&&!physicalChannel(3u)&&all(coatBase==N))){
   let m=physicalUvMatrix(r.maps.w);
   frame=cotangentFrame(coatBase,e1,e2,m*c.d1,m*c.d2);
  }
  let f=screenFace*coatFace;
  coatN=uniteOuZero(frame.T*(f*n.x*r.coatNormalScale.x)+frame.B*(f*n.y*r.coatNormalScale.y)+coatBase*n.z);
 }
 return PhysicalLobes(direction,coatN,strength,coat,coatRough);
}
/** Whether a pixel's lobes leave neither lobe: the strength and the coat not above zero. */
fn physicalLobeless(v:PhysicalLobes)->bool{return !(v.strength>0.0)&&!(v.coat>0.0);}`

/** A pixel's lobes as one texel of the lobes target (`../../scene/physicalLobes.ts`): what the
 *  opaque resolve stores and the water's surface stage writes (`../../webgpu/water/surfaceWgsl.ts`).
 *  The host declares \`LOBE_PACK_WGSL\` and \`physicalCoreWgsl\`. */
export const PHYSICAL_TEXEL_WGSL = `fn physicalTexel(v:PhysicalLobes)->vec4u{return vec4u(lobeOctEncode(v.direction),lobeOctEncode(v.coatN),pack2x16unorm(vec2f(v.strength,v.coat)),bitcast<u32>(v.coatRough));}`

/**
 * The lobes in the opaque resolve (`shadeWgsl.ts`): run on a lit row that names a record
 * (`PageInfo.physical`), its triangle's edges the frame's displacements, its second UV set decoded
 * at the triangle's corners (`pageUv1`). What the lighting needs is left in the lobes target
 * (`../../scene/physicalLobes.ts`) under `PHYSICAL_SURFACE_FLAG`, which a pixel with neither lobe
 * after its maps never carries. The target is full-size whenever a row names a record: it follows
 * the rows' surfaces right before this resolve (`followLobes`), so the pixel, bounded by the frame,
 * is never past it — and a store past a texture's bounds writes nothing.
 */
export const PHYSICAL_RESOLVE_WGSL = `${physicalTableWgsl(SHADE_BINDINGS.physical)}
@group(0) @binding(${SHADE_BINDINGS.lobes}) var lobesOutput:texture_storage_2d<${PHYSICAL_LOBES_FORMAT},write>;
${LOBE_PACK_WGSL}
${physicalCoreWgsl('HAS_SAMPLING')}
${PHYSICAL_TEXEL_WGSL}
/** The second UV set of triangle \`tri\` at the pixel, where its page has one; \`first\` otherwise. */
fn physicalSecondUv(page:PageInfo,tri:u32,s0:vec2f,s1:vec2f,s2:vec2f,p:vec2f,bary:vec3f,iw:vec3f,first:PhysicalCoord)->PhysicalCoord{
 let h=pageHeader(page);
 if(!pageHasUv1(page,h)){return first;}
 let k=pageTriangle(page,h,tri);let end=normalTexels();
 let a=pageUv1(page,h,k.x,end);let b=pageUv1(page,h,k.y,end);let c=pageUv1(page,h,k.z,end);
 let g=uvGradients(s0,s1,s2,p,a,b,c,iw);
 return PhysicalCoord(a*bary.x+b*bary.y+c*bary.z,g[0],g[1],b-a,c-a);
}
/** The pixel's lobes, stored in the lobes target: the flag that says so, or zero. */
fn physicalLobes(pixel:vec2f,N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32)->u32{
 let v=physicalValues(N,coatBase,e1,e2,screenFace,coatFace);
 if(physicalLobeless(v)){return 0u;}
 textureStore(lobesOutput,vec2i(pixel),physicalTexel(v));
 return ${PHYSICAL_SURFACE_FLAG}u;
}`

/** What the resolve reads of a row's record before its tile request, spliced into
 *  \`shadeSurface\` where the triangle and the first UV set are known. */
export const PHYSICAL_UV_WGSL = `if(HAS_PHYSICAL&&page.physical!=0u){
  physicalRecord=physicalAt((page.physical&${PHYSICAL_RECORD_MASK}u)-1u);
  physicalCoord0=PhysicalCoord(uv,ddx,ddy,t.uvb-t.uva,t.uvc-t.uva);
  physicalCoord1=physicalCoord0;
  if(physicalRecord.channels!=0u){physicalCoord1=physicalSecondUv(page,tri,s0.xy,s1.xy,s2.xy,p,bary,t.iw,physicalCoord0);}
 }`

/** The lobes of a lit pixel, once its normal and its flag are final. */
export const PHYSICAL_LOBES_CALL_WGSL = `if(HAS_PHYSICAL&&page.physical!=0u&&(page.flags&1u)!=0u){
  flag|=physicalLobes(pos.xy,N,coatBase,(w1-w0).xyz,(w2-w0).xyz,screenFace,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL));
 }`
