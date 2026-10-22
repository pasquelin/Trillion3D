import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { ORM_LAW_WGSL } from '../../lighting/ormWgsl.ts'
import { SAMPLE_TRANSFORMED } from '../../materials/texture/sampling.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import {
  LOBE_PACK_WGSL,
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_SURFACE_FLAG,
} from '../../materials/surface/physicalLobes.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { tangentFallback } from '../../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { unitToSigned2, unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import { FLAG_LIT } from '../types.ts'

/** The texture set map `i` of a channels word reads (`channelsOf`, `materialRecord.ts`): two bits a
 *  map, map `i`'s at bit `2i`, glTF's `texCoord`. */
export const MAP_CHANNEL_WGSL = wgslFn(
  'mapChannel',
  [],
  'fn mapChannel(channels:u32,i:u32)->u32{return (channels>>(2u*i))&3u;}',
)

/** The texture sets a channels word names, as a mask: bit `s` set where a map reads set `s`, bit 0
 *  where one reads the first or none is named (an unused pair reads 0). */
const CHANNEL_SETS_WGSL = wgslFn(
  'channelSets',
  [MAP_CHANNEL_WGSL],
  `fn channelSets(channels:u32)->u32{
 var sets=0u;
 for(var i=0u;i<16u;i++){sets|=1u<<mapChannel(channels,i);}
 return sets;
}`,
)

/**
 * The anisotropic and clear-coat lobes of a surface, from the Khronos material extension equations:
 * one implementation, which the opaque resolve (`PHYSICAL_RESOLVE_WGSL`, compiled into the
 * `HAS_PHYSICAL` class alone) and the blend pass (`../../blend/physicalWgsl.ts`, its lobed
 * programs alone) both run. A pass sets the record (`physicalAt`, its surface's lobe extension in the material table,
 * `../../materials/table/materialWgsl.ts`), `physicalOn`, and the pixel's four UV sets —
 * each a coordinate, its screen derivatives and its deltas along two displacements `e1`, `e2` of
 * the point, which a tangent frame is built from — and `sampled`, the expression its maps' filter
 * flag is read with.
 *
 * Each map reads through the data atlas as the material's other data maps do — native size, its
 * filters, addressing and UV transform in its slot's header (`../../materials/virtual/wgsl.ts`), its
 * tiles asked by the pixel (`physicalRequest`) — at its own UV set. Anisotropy RG is a direction,
 * B its strength; coat R and coat-roughness G are linear data; the coat normal map is bent in the
 * frame of its own coordinates, its transform included, and of the normal before the base normal
 * map, its two scales applied. The direction is rotated from the tangent the first UV set gives
 * the final normal, kept orthogonal to it.
 */
export const physicalCoreWgsl = (sampled: string) =>
  wgslBlock(
    `physicalCoreWgsl(${sampled})`,
    [
      ORM_LAW_WGSL,
      unitOrZero,
      tangentFallback,
      vectorRejection,
      unitToSigned2,
      unitToSigned3,
      MAP_CHANNEL_WGSL,
    ],
    `struct PhysicalCoord{uv:vec2f,ddx:vec2f,ddy:vec2f,d1:vec2f,d2:vec2f,}
/** Whether the pixel's surface carries a lobe, its record read. */
var<private> physicalOn:bool;
var<private> physicalRecord:PhysicalInfo;
/** The pixel's four UV sets, by rank: a set its geometry lacks holds the first's. */
var<private> physicalCoords:array<PhysicalCoord,4>;
/** The texture set map \`i\` of the record reads (\`PHYSICAL_MAP_FIELDS\` order). */
fn physicalChannel(i:u32)->u32{return mapChannel(physicalRecord.channels,i);}
/** The UV set map \`i\` of the record reads. */
fn physicalCoord(i:u32)->PhysicalCoord{return physicalCoords[physicalChannel(i)];}
fn physicalSample(i:u32,slot:u32)->vec4f{
 let c=physicalCoord(i);
 return dataSample(slot,c.uv,c.ddx,c.ddy,${sampled});
}
/** The linear part of a data slot's UV transform, identity without one. */
fn physicalUvMatrix(slot:u32)->mat2x2f{
 if((dataSlot(slot).sampling&${SAMPLE_TRANSFORMED}u)==0u){return mat2x2f(1.0,0.0,0.0,1.0);}
 let x=dataUvTransform(slot);
 return mat2x2f(x[0],x[1]);
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
 *  frame (the normal map's own). Where the surface stores tangents (\`stored\`), \`tangents\` is
 *  their frame at the pixel, the one the pass bends its normal map in: both lobes take it, as the
 *  normal map does; without, each builds its frame from its own coordinates. */
struct PhysicalLobes{direction:vec3f,coatN:vec3f,strength:f32,coat:f32,coatRough:f32,}
fn physicalValues(N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32,tangents:CotangentFrame,stored:bool)->PhysicalLobes{
 let r=physicalRecord;
 var strength=r.lobes.x;var rotation=r.lobes.y;var coat=r.lobes.z;var coatRough=r.lobes.w;
 if(r.maps.x!=0u){
  let m=physicalSample(0u,r.maps.x).rgb;let d=unitToSigned2(m.rg);
  strength*=m.b;
  if(dot(d,d)>0.0){rotation+=atan2(d.y,d.x);}
 }
 // The coat and its roughness packed in one texture, as glTF writes them, read it once.
 var coatSample=vec4f(1.0);
 if(r.maps.y!=0u){coatSample=physicalSample(1u,r.maps.y);coat*=coatSample.r;}
 if(r.maps.z!=0u){
  if(r.maps.z!=r.maps.y||physicalChannel(1u)!=physicalChannel(2u)){coatSample=physicalSample(2u,r.maps.z);}
  coatRough=ormRoughness(r.lobes.w,coatSample.g);
 }
 var direction=vec3f(0.0,0.0,1.0);
 var frame0:CotangentFrame;
 if(strength>0.0){
  // The stored frame is the world's, turned to the row's side; a built one is the screen's.
  var fT=tangents.T;var fB=tangents.B;
  if(!stored){
   let c=physicalCoords[0];
   frame0=cotangentFrame(N,e1,e2,c.d1,c.d2);
   fT=frame0.T*screenFace;fB=frame0.B*screenFace;
  }
  var T=vectorRejection(fT,N);
  if(dot(T,T)<1e-12){T=tangentFallback(N);}
  T=normalize(T);var B=normalize(cross(N,T));
  if(dot(B,fB)<0.0){B=-B;}
  direction=cos(rotation)*T+sin(rotation)*B;
 }
 var coatN=coatBase;
 if(coat>0.0&&r.maps.w!=0u){
  let n=unitToSigned3(physicalSample(3u,r.maps.w).xyz);
  let bent=vec3f(n.x*r.coatNormalScale.x,n.y*r.coatNormalScale.y,n.z);
  if(stored){coatN=bendNormal(coatBase,tangents.T,tangents.B,coatFace,bent);}
  else{
   // The anisotropy's frame where it is the coat's own: the same normal, the first UV set, no
   // transform on the map.
   let c=physicalCoord(3u);
   var frame=frame0;
   let identity=(dataSlot(r.maps.w).sampling&${SAMPLE_TRANSFORMED}u)==0u;
   if(!(strength>0.0&&identity&&physicalChannel(3u)==0u&&all(coatBase==N))){
    let m=physicalUvMatrix(r.maps.w);
    frame=cotangentFrame(coatBase,e1,e2,m*c.d1,m*c.d2);
   }
   coatN=bendNormal(coatBase,frame.T,frame.B,screenFace*coatFace,bent);
  }
 }
 return PhysicalLobes(direction,coatN,strength,coat,coatRough);
}
/** Whether a pixel's lobes leave neither lobe: the strength and the coat not above zero. */
fn physicalLobeless(v:PhysicalLobes)->bool{return !(v.strength>0.0)&&!(v.coat>0.0);}`,
  )

/** A pixel's lobes as one texel of the lobes target (`../../materials/surface/physicalLobes.ts`): what the
 *  opaque resolve stores.
 *  The host lists \`physicalCoreWgsl\`. */
export const PHYSICAL_TEXEL_WGSL = wgslBlock(
  'PHYSICAL_TEXEL_WGSL',
  [LOBE_PACK_WGSL],
  `fn physicalTexel(v:PhysicalLobes)->vec4u{return vec4u(lobeOctEncode(v.direction),lobeOctEncode(v.coatN),pack2x16unorm(vec2f(v.strength,v.coat)),bitcast<u32>(v.coatRough));}`,
)

/**
 * The lobes in the opaque resolve (`shadeWgsl.ts`): run on a lit row whose surface's record names
 * a lobe extension (`materialLobesOf`), its triangle's edges the frame's displacements, its UV sets past
 * the first decoded at the triangle's corners (`pageUvSet`). What the lighting needs is left in the lobes target
 * (`../../materials/surface/physicalLobes.ts`) under `PHYSICAL_SURFACE_FLAG`, which a pixel with neither lobe
 * after its maps never carries. The target is full-size whenever a row names a record: it follows
 * the rows' surfaces right before this resolve (`followLobes`), so the pixel, bounded by the frame,
 * is never past it — and a store past a texture's bounds writes nothing.
 */
export const PHYSICAL_RESOLVE_WGSL = wgslBlock(
  'PHYSICAL_RESOLVE_WGSL',
  [
    physicalCoreWgsl('HAS_SAMPLING'),
    PHYSICAL_TEXEL_WGSL,
    CHANNEL_SETS_WGSL,
    materialTableWgsl(SHADE_BINDINGS.material),
  ],
  `@group(0) @binding(${SHADE_BINDINGS.lobes}) var lobesOutput:texture_storage_2d<${PHYSICAL_LOBES_FORMAT},write>;
/** The UV set map \`i\` of the surface record \`m\` reads (\`SURFACE_MAP_FIELDS\` order, its
 *  \`channels\` word): the pixel's set of that rank, which the resolve decodes. */
fn mapCoord(m:Material,i:u32)->PhysicalCoord{return physicalCoords[mapChannel(m.channels,i)];}
/** The UV sets past the first that \`used\` (\`channelSets\`) names, decoded at the corners of triangle
 *  \`tri\` where its page has them; the pixel holds the first set's otherwise. */
fn physicalOtherUvs(page:PageInfo,tri:u32,s0:vec2f,s1:vec2f,s2:vec2f,p:vec2f,bary:vec3f,iw:vec3f,used:u32){
 if((used>>1u)==0u){return;}
 let h=pageHeader(page);
 let k=pageTriangle(page,h,tri);let end=normalTexels();
 for(var s=1u;s<${MAX_UV_SETS}u;s++){
  if((used&(1u<<s))!=0u&&pageHasUvSet(page,h,s)){
   let a=pageUvSet(page,h,k.x,s,end);let b=pageUvSet(page,h,k.y,s,end);let c=pageUvSet(page,h,k.z,s,end);
   let g=uvGradients(s0,s1,s2,p,a,b,c,iw);
   physicalCoords[s]=PhysicalCoord(a*bary.x+b*bary.y+c*bary.z,g[0],g[1],b-a,c-a);
  }
 }
}
/** The pixel's lobes, stored in the lobes target: the flag that says so, or zero. */
fn physicalLobes(pixel:vec2f,N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32,tangents:CotangentFrame,stored:bool)->u32{
 let v=physicalValues(N,coatBase,e1,e2,screenFace,coatFace,tangents,stored);
 if(physicalLobeless(v)){return 0u;}
 textureStore(lobesOutput,vec2i(pixel),physicalTexel(v));
 return ${PHYSICAL_SURFACE_FLAG}u;
}`,
)

/** What the resolve reads of a row's record before its tile request, spliced into
 *  `shadeSurface` where the triangle and the first UV set are known: the pixel's four UV sets —
 *  those past the first decoded, in the `HAS_PHYSICAL` classes alone, where a map of the surface
 *  (`m.channels`, `mapCoord`) or of its lobes reads them — and the lobe record. */
export const physicalUvRead = (
  /** More texture sets to decode, as ` | mask` a graph reads (`shadeGraphWgsl.ts`). */
  sets = '',
) => `physicalCoords[0]=PhysicalCoord(uv,ddx,ddy,t.uvb-t.uva,t.uvc-t.uva);
 physicalCoords[1]=physicalCoords[0];physicalCoords[2]=physicalCoords[0];physicalCoords[3]=physicalCoords[0];
 var lobes=0u;
 if(HAS_PHYSICAL){lobes=materialLobesOf(page.material);}
 if(lobes!=0u){
  physicalOn=true;
  physicalRecord=physicalAt(lobes);
 }
 if(HAS_PHYSICAL){
  var used=channelSets(m.channels)${sets};
  if(lobes!=0u){used|=channelSets(physicalRecord.channels);}
  physicalOtherUvs(page,tri,s0.xy,s1.xy,s2.xy,p,bary,t.iw,used);
 }`

/** `physicalUvRead` with no graph's sets. */
export const PHYSICAL_UV_READ = physicalUvRead()

/** The lobes of a lit pixel, once its normal and its flag are final: in the stored tangents'
 *  frame the normal map bent in (`tangents`, `shadeWgsl.ts`) where the page stores them. */
export const PHYSICAL_LOBES_CALL = `if(HAS_PHYSICAL&&physicalOn&&(page.flags&${FLAG_LIT}u)!=0u){
  flag|=physicalLobes(pos.xy,N,coatBase,(w1-w0).xyz,(w2-w0).xyz,screenFace,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),tangents,HAS_TANGENT);
 }`
