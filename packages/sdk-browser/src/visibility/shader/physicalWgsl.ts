import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { ORM_LAW_WGSL } from '../../lighting/ormWgsl.ts'
import { SAMPLE_TRANSFORMED } from '../../materials/texture/sampling.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { MAP_CHANNEL_BITS } from '../../materials/table/materialRecord.ts'
import {
  LOBE_PACK_WGSL,
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_SURFACE_FLAG,
} from '../../materials/surface/physicalLobes.ts'
import { specularFlag } from '../../materials/surface/surfaceSpecular.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { tangentFallback } from '../../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { unitToSigned2, unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import { FLAG_LIT } from '../types.ts'
import { CLOTH_MAP_AT, SPECULAR_MAP_AT } from '../materialType.ts'

/** The maps a channels word holds at most. */
export const CHANNEL_SLOTS = Math.floor(32 / MAP_CHANNEL_BITS)

/** The texture set map `i` of a channels word reads (`channelsOf`, `materialRecord.ts`):
 *  `MAP_CHANNEL_BITS` a map, map `i`'s at bit `MAP_CHANNEL_BITS * i`, glTF's `texCoord`. */
export const MAP_CHANNEL_WGSL = wgslFn(
  'mapChannel',
  [],
  `fn mapChannel(channels:u32,i:u32)->u32{return (channels>>(${MAP_CHANNEL_BITS}u*i))&${(1 << MAP_CHANNEL_BITS) - 1}u;}`,
)

/** The texture sets a channels word names, as a mask: bit `s` set where a map reads set `s`, bit 0
 *  where one reads the first or none is named (an unused slot reads 0). */
export const CHANNEL_SETS_WGSL = wgslFn(
  'channelSets',
  [MAP_CHANNEL_WGSL],
  `fn channelSets(channels:u32)->u32{
 var sets=0u;
 for(var i=0u;i<${CHANNEL_SLOTS}u;i++){sets|=1u<<mapChannel(channels,i);}
 return sets;
}`,
)

/** The pixel's record, UV sets and map reads. */
const PHYSICAL_RECORD_TEXT = (
  sampled: string,
) => `struct PhysicalCoord{uv:vec2f,ddx:vec2f,ddy:vec2f,d1:vec2f,d2:vec2f,}
/** Whether the pixel's surface carries a lobe, its record read. */
var<private> physicalOn:bool;
var<private> physicalRecord:PhysicalInfo;
/** The tangent, in tangent space, of the anisotropy of a pixel whose lobes a graph computes
 *  (\`PhysicalInfo.law\`: 1 the highlight along the tangent, 2 along the bitangent). */
var<private> physicalTangent:vec3f;
/** The pixel's UV sets, by rank: a set its geometry lacks holds the first's. */
var<private> physicalCoords:array<PhysicalCoord,${MAX_UV_SETS}>;
/** The texture set map \`i\` of the record reads (\`PHYSICAL_MAP_FIELDS\` order). */
fn physicalChannel(i:u32)->u32{return mapChannel(physicalRecord.channels,i);}
/** The UV set map \`i\` of the record reads. */
fn physicalCoord(i:u32)->PhysicalCoord{return physicalCoords[physicalChannel(i)];}
/** Map \`i\` of the record sampled at its own UV set. */
fn physicalSample(i:u32)->vec4f{
 let c=physicalCoord(i);
 return dataSample(physicalRecord.maps[i],c.uv,c.ddx,c.ddy,${sampled});
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
 if(i==${CLOTH_MAP_AT + 1}u){return colorRequestIndex(slot,c.uv,c.ddx,c.ddy,p.next,p.along,true,${sampled},missing);}
 return dataRequestIndex(slot,c.uv,c.ddx,c.ddy,p.next,p.along,true,${sampled},missing);
}
`

/** The lobes' values read from the maps. */
const PHYSICAL_VALUES_READS_TEXT = (
  sampled: string,
) => `/** The pixel's lobes: the anisotropy direction, the coat normal, the strength, the coat and its
 *  roughness, the cloth's fuzz colour and amount after the maps — no lobe where the strength, the
 *  coat and the cloth are not above zero — and the specular, negative where none is declared.
 *  \`N\` is the shading normal, \`coatBase\` the normal before the base normal map, \`screenFace\`
 *  the side the frame of \`e1\`, \`e2\` is seen from, \`coatFace\` the turn of a two-sided surface's
 *  frame (the normal map's own). Where the surface stores tangents (\`stored\`), \`tangents\` is
 *  their frame at the pixel, the one the pass bends its normal map in: both lobes take it, as the
 *  normal map does; without, each builds its frame from its own coordinates. */
struct PhysicalLobes{direction:vec3f,coatN:vec3f,strength:f32,coat:f32,coatRough:f32,fuzz:vec3f,cloth:f32,specular:f32,}
fn physicalValues(N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32,tangents:CotangentFrame,stored:bool)->PhysicalLobes{
 let r=physicalRecord;
 var strength=r.lobes.x;var rotation=r.lobes.y;var coat=r.lobes.z;var coatRough=r.lobes.w;
 if(r.maps[0]!=0u){
  let m=physicalSample(0u).rgb;let d=unitToSigned2(m.rg);
  strength*=m.b;
  if(dot(d,d)>0.0){rotation+=atan2(d.y,d.x);}
 }
 // The coat and its roughness packed in one texture, as glTF writes them, read it once.
 var coatSample=vec4f(1.0);
 if(r.maps[1]!=0u){coatSample=physicalSample(1u);coat*=coatSample.r;}
 if(r.maps[2]!=0u){
  if(r.maps[2]!=r.maps[1]||physicalChannel(1u)!=physicalChannel(2u)){coatSample=physicalSample(2u);}
  coatRough=ormRoughness(r.lobes.w,coatSample.g);
 }
 // The cloth: the fuzz colour and the amount, the cloth model having no anisotropy.
 var fuzz=r.sheen.xyz;var cloth=r.sheen.w;
 if(r.maps[${CLOTH_MAP_AT + 1}]!=0u){let c=physicalCoord(${CLOTH_MAP_AT + 1}u);fuzz*=colorSample(r.maps[${CLOTH_MAP_AT + 1}],c.uv,c.ddx,c.ddy,${sampled}).rgb;}
 if(r.maps[${CLOTH_MAP_AT}]!=0u){cloth*=physicalSample(${CLOTH_MAP_AT}u).a;}
 cloth=saturate(cloth);
 // The specular a surface declares, its map's alpha scaling it; negative where it declares none.
 var specular=r.specular;
 if(specular>=0.0&&r.maps[${SPECULAR_MAP_AT}]!=0u){specular*=physicalSample(${SPECULAR_MAP_AT}u).a;}
 `

/** The anisotropy direction and the coat normal, the lobes returned. */
const PHYSICAL_VALUES_LOBES_TEXT = `if(cloth>0.0){strength=0.0;}
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
  if(r.law!=0u){
   // A graph's tangent, carried from tangent space to the world by the frame and the normal the maps
   // did not bend, kept orthogonal to the shading normal; the highlight lies along the bitangent
   // where the anisotropy is negative.
   var G=vectorRejection(physicalTangent.x*fT+physicalTangent.y*fB+physicalTangent.z*coatBase,N);
   if(dot(G,G)<1e-12){G=tangentFallback(N);}
   G=normalize(G);
   direction=select(G,normalize(cross(N,G)),r.law==2u);
  }else{
   var T=vectorRejection(fT,N);
   if(dot(T,T)<1e-12){T=tangentFallback(N);}
   T=normalize(T);var B=normalize(cross(N,T));
   if(dot(B,fB)<0.0){B=-B;}
   direction=cos(rotation)*T+sin(rotation)*B;
  }
 }
 // The coat shares the base's normal unless the clear coat keeps a bottom normal (\`clearCoatNormal\`): then the surface's
 // own is the base's, the coat's the geometry's, bent by its own map.
 var coatN=select(N,coatBase,uni.clearCoatNormal!=0u);
 if(coat>0.0&&r.maps[3]!=0u&&uni.clearCoatNormal!=0u){
  let n=unitToSigned3(physicalSample(3u).xyz);
  let bent=vec3f(n.x*r.coatNormalScale.x,n.y*r.coatNormalScale.y,n.z);
  if(stored){coatN=bendNormal(coatBase,tangents.T,tangents.B,coatFace,bent);}
  else{
   // The anisotropy's frame where it is the coat's own: the same normal, the first UV set, no
   // transform on the map.
   let c=physicalCoord(3u);
   var frame=frame0;
   let identity=(dataSlot(r.maps[3]).sampling&${SAMPLE_TRANSFORMED}u)==0u;
   if(!(strength>0.0&&identity&&physicalChannel(3u)==0u&&all(coatBase==N))){
    let m=physicalUvMatrix(r.maps[3]);
    frame=cotangentFrame(coatBase,e1,e2,m*c.d1,m*c.d2);
   }
   coatN=bendNormal(coatBase,frame.T,frame.B,screenFace*coatFace,bent);
  }
 }
 return PhysicalLobes(direction,coatN,strength,coat,coatRough,fuzz,cloth,specular);
}
/** Whether a pixel's lobes leave no lobe: the strength, the coat and the cloth not above zero. */
fn physicalLobeless(v:PhysicalLobes)->bool{return !(v.strength>0.0)&&!(v.coat>0.0)&&!(v.cloth>0.0);}`

/**
 * The anisotropic, clear-coat and cloth lobes of a surface, from the Khronos material extension equations:
 * one implementation, which the opaque resolve (`PHYSICAL_RESOLVE_WGSL`, compiled into the
 * `HAS_PHYSICAL` class alone) and the blend pass (`../../blend/physicalWgsl.ts`, its lobed
 * programs alone) both run. A pass sets the record (`physicalAt`, its surface's lobe extension in the material table,
 * `../../materials/table/materialWgsl.ts`), `physicalOn`, and the pixel's UV sets —
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
 * the final normal, kept orthogonal to it. A cloth's fuzz colour is its factor times its colour map
 * (read in sRGB through the colour atlas), its cloth amount the sheen roughness times the alpha of
 * its map; the cloth model has no anisotropy, so a cloth pixel leaves none.
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
    `${PHYSICAL_RECORD_TEXT(sampled)}${PHYSICAL_VALUES_READS_TEXT(sampled)}${PHYSICAL_VALUES_LOBES_TEXT}`,
  )

/** A pixel's lobes as one texel of the lobes target (`../../materials/surface/physicalLobes.ts`): what the
 *  opaque resolve stores.
 *  The host lists \`physicalCoreWgsl\`. */
export const PHYSICAL_TEXEL_WGSL = wgslBlock(
  'PHYSICAL_TEXEL_WGSL',
  [LOBE_PACK_WGSL],
  `fn physicalTexel(v:PhysicalLobes)->vec4u{
 if(v.cloth>0.0){return clothTexel(v.fuzz,v.cloth);}
 return vec4u(lobeOctEncode(v.direction),lobeOctEncode(v.coatN),pack2x16unorm(vec2f(v.strength,v.coat)),bitcast<u32>(v.coatRough));
}`,
)

/**
 * The lobes in the opaque resolve (`shadeWgsl.ts`): run on a lit row whose surface's record names
 * a lobe extension (`materialLobesOf`), its triangle's edges the frame's displacements, its UV sets past
 * the first decoded at the triangle's corners (`pageUvSet`). What the lighting needs is left in the lobes
 * target (`../../materials/surface/physicalLobes.ts`) under `PHYSICAL_SURFACE_FLAG`, which a pixel
 * with neither lobe after its maps never carries. The target is full-size whenever a surface wants
 * it (`followLobes`) before this resolve, so the pixel, bounded by the frame, is never past it — and
 * a store past a texture's bounds writes nothing.
 */
export const PHYSICAL_RESOLVE_WGSL = wgslBlock(
  'PHYSICAL_RESOLVE_WGSL',
  [
    physicalCoreWgsl('HAS_SAMPLING'),
    PHYSICAL_TEXEL_WGSL,
    CHANNEL_SETS_WGSL,
    materialTableWgsl(SHADE_BINDINGS.material),
    specularFlag,
  ],
  `@group(0) @binding(${SHADE_BINDINGS.lobes}) var lobesOutput:texture_storage_2d<${PHYSICAL_LOBES_FORMAT},write>;
/** The UV set map \`i\` of the surface record \`m\` reads (\`SURFACE_MAP_FIELDS\` order, its
 *  \`channels\` word): the pixel's set of that rank, which the resolve decodes. */
fn mapCoord(m:Material,i:u32)->PhysicalCoord{return physicalCoords[mapChannel(m.channels,i)];}
/** The UV sets past the first that \`used\` (\`channelSets\`) names, decoded at the corners \`k\` of the
 *  header \`h\` where its page has them; the pixel holds the first set's otherwise. */
fn physicalOtherUvs(page:PageInfo,h:ClusterHeader,k:vec3u,bary:vec3f,dx:vec3f,dy:vec3f,used:u32){
 if((used>>1u)==0u){return;}
 let end=normalTexels();
 for(var s=1u;s<${MAX_UV_SETS}u;s++){
  if((used&(1u<<s))!=0u&&pageHasUvSet(page,h,s)){
   let uv=pageUvSet3(page,h,k,s,end);let a=uv[0];let b=uv[1];let c=uv[2];
   let g=uvGradients(dx,dy,a,b,c);
   physicalCoords[s]=PhysicalCoord(a*bary.x+b*bary.y+c*bary.z,g[0],g[1],b-a,c-a);
  }
 }
}
/** The flag bits a pixel's lobes leave in its surface flags (the coat's roughness at least the pixel's \`curvature\`): the lobes stored in the lobes target
 *  (\`PHYSICAL_SURFACE_FLAG\`) and the specular it declares, or zero. */
fn physicalLobes(pixel:vec2f,N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32,tangents:CotangentFrame,stored:bool,curvature:f32)->u32{
 var v=physicalValues(N,coatBase,e1,e2,screenFace,coatFace,tangents,stored);
 v.coatRough=max(v.coatRough,curvature);
 let specular=select(0u,specularFlag(v.specular),v.specular>=0.0);
 if(physicalLobeless(v)){return specular;}
 textureStore(lobesOutput,vec2i(pixel),physicalTexel(v));
 return ${PHYSICAL_SURFACE_FLAG}u|specular;
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
 for(var uvFill=1u;uvFill<${MAX_UV_SETS}u;uvFill++){physicalCoords[uvFill]=physicalCoords[0];}
 var lobes=0u;
 if(HAS_PHYSICAL){lobes=materialLobesOf(page.material);}
 if(lobes!=0u){
  physicalOn=true;
  physicalRecord=physicalAt(lobes);
 }
 if(HAS_PHYSICAL){
  var used=channelSets(m.channels)${sets};
  if(lobes!=0u){used|=channelSets(physicalRecord.channels);}
  physicalOtherUvs(page,t.h,t.k,bary,stepX,stepY,used);
 }`

/** The lobes of a lit pixel, once its normal, roughness and flag are final: in the stored tangents'
 *  frame the normal map bent in (`tangents`, `shadeWgsl.ts`) where the page stores them. A merged
 *  coat changes the normal and roughness it hands back. */
export const PHYSICAL_LOBES_CALL = `if(HAS_PHYSICAL&&physicalOn&&(page.flags&${FLAG_LIT}u)!=0u){
  flag|=physicalLobes(pos.xy,N,coatBase,(w1-w0).xyz,(w2-w0).xyz,screenFace,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),tangents,HAS_TANGENT,curvature);
 }`
