import { declaredLightingWgsl } from './directLightingWgsl.ts';
import { bounceApplyWgsl } from './bounceApplyWgsl.ts';
import { STANDARD_LIGHTING_WGSL, NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { TRIANGLE_PALETTE_WGSL } from './trianglePalette.ts';
import {
  ATLAS_SLOTS_WGSL,
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  atlasTextures,
} from './webgpuAtlasWgsl.ts';
import { BLEND_BINDINGS } from './webgpuBindLayout.ts';
import { BLEND_ITEM_WGSL } from './webgpuBlendItems.ts';
import { FLAG_PAGED, FLAG_TRANSMISSIVE, FLAG_UNLIT_VIEW } from './visibilityBuffer.ts';
import { WRAP_MAP } from './visibilityWrapModes.ts';
import { TRANSMISSION_WGSL } from './webgpuTransmissionWgsl.ts';

/**
 * Le nuanceur des surfaces transparentes.
 *
 * Deux entrees seulement : un uniforme de vue, ecrit une fois par image pour toute la passe, et la
 * fiche de l'item, lue dans un tampon de stockage au rang que l'indice de sommet porte. Rien n'est
 * lie par appel, et l'ordre des appels est celui de la scene.
 */
export const BLEND_SHADER = `struct BlendView{viewProj:mat4x4f,camPos:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,}
${BLEND_ITEM_WGSL}
@group(0) @binding(${BLEND_BINDINGS.indices}) var<storage, read> indices:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.positions}) var<storage, read> positions:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uvs}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${BLEND_BINDINGS.items}) var<storage,read> items:array<BlendItem>;
${atlasTextures(BLEND_BINDINGS.maps, 'maps')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${atlasTextures(BLEND_BINDINGS.dataMaps, 'dataMaps')}
@group(0) @binding(${BLEND_BINDINGS.normals}) var<storage,read> normals:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.scales}) var<storage,read> scales:array<vec4f>;
${STANDARD_LIGHTING_WGSL}
${declaredLightingWgsl(BLEND_BINDINGS.proxy)}
${bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes)}
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.shadowSlices}) var<storage,read> shadows:ShadowSlices;
@group(0) @binding(${BLEND_BINDINGS.shadowAtlas}) var shadowAtlas:texture_depth_2d;
@group(0) @binding(${BLEND_BINDINGS.shadowSampler}) var shadowSampler:sampler_comparison;
@group(0) @binding(${BLEND_BINDINGS.clusterDiagnostic}) var<storage,read> clusterDiagnostic:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.colorSlots}) var<storage,read> colorSlots:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.dataSlots}) var<storage,read> dataSlots:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.planInstances}) var<storage,read> planInstances:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.clusterSpans}) var<storage,read> clusterSpans:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
${TRANSMISSION_WGSL}
${ATLAS_SLOTS_WGSL}
${COLOR_SAMPLE_WGSL}
${DATA_SAMPLE_WGSL}
${NORMAL_TRANSFORM_WGSL}
// Ce que l'étage de sommets lit sur la fiche de l'item et que l'étage de fragments relit tel quel :
// les six cartes, leurs facteurs et les drapeaux. Ils sont constants sur l'appel, donc PLATS — le
// fragment lit les mêmes bits qu'il lisait dans l'uniforme par item, sans liaison par appel.
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) uv:vec2f,@location(2) view:vec3f,@location(3) normal:vec3f,@location(4) tangent:vec3f,@location(5) bitangent:vec3f,@location(6) @interpolate(flat) tri:u32,@location(7) bary:vec3f,@location(8) @interpolate(flat) diagId:u32,@location(9) @interpolate(flat) ids:vec4u,@location(10) @interpolate(flat) maps:vec4u,@location(11) @interpolate(flat) uvA:vec4f,@location(12) @interpolate(flat) pbr:vec4f,@location(13) @interpolate(flat) emissive:vec4f,}
${TRIANGLE_PALETTE_WGSL}
// Une instance dessine une grappe paginee que la compaction a gardee, ou un morceau d'indices d'une
// primitive qui ne l'est pas. La liste que l'etalement du plan a ecrite dit, pour chacune, l'item
// qui la porte et ce qu'elle dessine (webgpuBlendExpandWgsl.ts).
//
// Le rang de la premiere instance de l'appel se lit dans les bits hauts de l'indice de sommet, et le
// rang local du sommet dans les bas : l'argument indirect d'une tranche commence au sommet
// base << vertexShift. C'est ce qui permet a une tranche entiere de tenir dans UN appel, sans rien
// a lier entre deux entrees du plan — firstInstance dirait la meme chose, mais WebGPU ne l'ouvre
// a un appel indirect que sous une extension.
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VSOut{
 var out:VSOut;
 let slot=planInstances[(vertexIndex>>uni.vertexShift)+instance];
 let it=items[slot.x];
 let local=vertexIndex&((1u<<uni.vertexShift)-1u);
 let flags=it.flags|uni.viewFlags;
 out.color=it.color;
 out.ids=vec4u(it.mapIndex,flags,it.emissiveIndex,it.wrapModes);
 out.maps=vec4u(it.roughIndex,it.metalIndex,it.normalIndex,it.aoIndex);
 out.uvA=vec4f(it.uvScale,it.alphaTest,it.aoIntensity);
 out.pbr=vec4f(it.roughness,it.metalness,it.normalScale);
 out.emissive=vec4f(it.emissive.xyz,0.0);
 var base=slot.y;
 var count=it.indexCount-slot.y;
 var clusterId=0u;
 if((flags&${FLAG_PAGED}u)!=0u){
  let span=clusterSpans[slot.y];
  base=span.x;
  count=span.y;
  clusterId=clusterDiagnostic[slot.y];
 }
 if(local>=count){out.position=vec4f(0.0,0.0,2.0,1.0);out.color=vec4f(0.0);out.uv=vec2f(0.0);out.view=vec3f(0.0);out.normal=vec3f(0.0,0.0,1.0);out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);out.tri=0u;out.bary=vec3f(0.0);out.diagId=0u;return out;}
 let id=it.vertexBase+indices[base+local];
 let world=it.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;
 out.tri=0u;
 out.diagId=0u;
 if((flags&0x1c000000u)!=0u){out.diagId=clusterId;}
 if((flags&0x20000000u)!=0u){
  let triangle=base+(local/3u)*3u;
  let a=triangleHash(indices[triangle]);let b=triangleHash(indices[triangle+1u]);let c=triangleHash(indices[triangle+2u]);
  out.tri=a^((b<<1u)|(b>>31u))^((c<<2u)|(c>>30u));
 }
 let corner=local%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 out.normal=vec3f(0.0);
 if((flags&16u)!=0u){out.normal=xformNormal(it.world,vec3f(normals[id*7u],normals[id*7u+1u],normals[id*7u+2u]));}
 out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);
 if((flags&256u)!=0u){out.normal=-out.normal;}
 if((flags&2048u)!=0u){
  out.tangent=uniteOuZero((it.world*vec4f(normals[id*7u+3u],normals[id*7u+4u],normals[id*7u+5u],0.0)).xyz);
  if((flags&256u)!=0u){out.tangent=-out.tangent;}
  out.bitangent=uniteOuZero(cross(out.normal,out.tangent)*normals[id*7u+6u]);
 }
 let i=id*2u;out.uv=vec2f(uvs[i],uvs[i+1u]);
 return out;
}
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let flags=in.ids.y;
 let wrap=in.ids.w;
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let q0=dpdx(in.view);let q1=dpdy(in.view);
 // uniteOuZero rend normalize partout ou le vecteur n'est pas nul : memes bits qu'avant sur une
 // surface ordinaire, vecteur nul — et non NaN — sur une face effondree, dont un NaN gagnerait les
 // pixels voisins par les derivees d'ecran. Une pose de rang 2 n'y arrive pas nulle : xformNormal
 // lui a deja donne la normale de la face aplatie.
 // La normale geometrique vient des derivees d'ecran : elle regarde deja l'observateur, quelle que
 // soit la face rasterisee. Seule une normale de sommet, qui pointe vers le dehors declare, se
 // retourne sur le dos d'un materiau a deux faces — la retourner aussi enverrait la geometrique a
 // l'oppose de la lumiere, et la surface rendrait exactement zero. Meme regle que la resolution
 // opaque, qui ne retourne que la normale interpolee.
 var N=uniteOuZero(-cross(q0,q1));
 let face=select(-1.0,1.0,front);
 if((flags&16u)!=0u){
  N=uniteOuZero(in.normal);
  if((flags&2u)!=0u){N*=face;}
 }
 let sample=colorSample(in.ids.x,in.uvA.xy,in.uv,wrapOf(wrap,${WRAP_MAP.base}u),gradX,gradY);
 let alpha=sample.w*in.color.w;
 // \`fwidth\` exige un flot de contrôle uniforme : les drapeaux viennent de la fiche par item, donc
 // la dérivée est prise avant toute condition qui en dépend et n'est lue que par la vue « fil de fer ».
 let width=fwidth(in.bary);
 if((flags&0x40000000u)!=0u){
  if(alpha<=0.01||alpha<in.uvA.z){discard;}
  var color=vec3f(0.204,0.827,0.6);
  if((flags&0x20000000u)!=0u){
   let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
   color=mix(hashColor(in.tri),vec3f(0.04,0.05,0.07),edge);
  }else if((flags&0x10000000u)!=0u){color=select(vec3f(0.5,0.55,0.6),hashColor(in.diagId&0x00ffffffu),in.diagId!=0u);}
  else if((flags&0x08000000u)!=0u){color=select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),(in.diagId&0x80000000u)!=0u);}
  else if((flags&0x04000000u)!=0u){let ratio=f32((in.diagId>>24u)&127u)/127.0;color=vec3f(ratio,1.0-ratio,0.12);}
  return vec4f(color,1.0);
 }
 var rgb=in.color.xyz*sample.xyz;
 // La teinte du materiau avant tout eclairage : c'est elle qui colore le fond qu'une surface
 // transmissive laisse voir, jamais la couleur deja eclairee.
 let baseTint=rgb;
 var rough=in.pbr.x;var metal=in.pbr.y;var ao=1.0;
 if(in.maps.x!=0u){rough*=dataSample(in.maps.x,scales[in.maps.x].xy,in.uv,wrapOf(wrap,${WRAP_MAP.rough}u),gradX,gradY).g;}
 if(in.maps.y!=0u){metal*=dataSample(in.maps.y,scales[in.maps.y].xy,in.uv,wrapOf(wrap,${WRAP_MAP.metal}u),gradX,gradY).b;}
 if(in.maps.w!=0u){ao+=in.uvA.w*(dataSample(in.maps.w,scales[in.maps.w].xy,in.uv,wrapOf(wrap,${WRAP_MAP.ao}u),gradX,gradY).r-1.0);}
 if(in.maps.z!=0u){
  let mapN=dataSample(in.maps.z,scales[in.maps.z].xy,in.uv,wrapOf(wrap,${WRAP_MAP.normal}u),gradX,gradY).xyz*2.0-vec3f(1.0);
  var T=-(cross(q1,N)*gradX.x+cross(N,q0)*gradY.x);
  var B=-(cross(q1,N)*gradX.y+cross(N,q0)*gradY.y);
  if((flags&2048u)!=0u){T=uniteOuZero(in.tangent);B=uniteOuZero(in.bitangent);}
  if((flags&2u)!=0u&&(flags&16u)!=0u){T*=face;B*=face;}
  let tbnScale=inverseSqrt(max(max(dot(T,T),dot(B,B)),1e-20));
  N=uniteOuZero(T*tbnScale*mapN.x*in.pbr.z+B*tbnScale*mapN.y*in.pbr.w+N*mapN.z);
 }
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){emissive*=colorSample(in.ids.z,scales[in.ids.z].zw,in.uv,wrapOf(wrap,${WRAP_MAP.emissive}u),gradX,gradY).rgb;}
 if(alpha<in.uvA.z){discard;}
 // Aucune lampe declaree, ou vue sans eclairage demandee : l'albedo brut, exactement comme la
 // resolution opaque. Ni ambiance, ni ciel, ni soleil par defaut (P6).
 let unlit=(flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let V=normalize(uni.camPos.xyz-in.view);
 let clamped=clamp(rough,0.0525,1.0);
 if(!unlit&&(flags&1u)!=0u){
  let m=clamp(metal,0.0,1.0);
  rgb=declaredLighting(rgb,m,clamped,N,V,in.view,ao,in.position.xy)+bounceLighting(rgb,m,N,in.view,ao)+emissive;
 }
 // La classe 3 relit le fond fige au lieu de le melanger par alpha. Le drapeau vient du materiau,
 // et cette passe est la seule a le porter : une vue sans eclairage transmet toujours ce qu'elle
 // voit derriere, elle ne l'eclaire simplement pas.
 if((flags&${FLAG_TRANSMISSIVE}u)!=0u){
  return transmissionColor(rgb,baseTint,alpha,N,V,in.view,in.position.xy,in.position.z,clamped,ao,unlit);
 }
 return vec4f(rgb,alpha);
}
`;
