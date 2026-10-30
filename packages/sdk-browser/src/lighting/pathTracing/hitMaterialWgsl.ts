import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { PT_MATERIAL_WGSL } from './materialWgsl.ts'

/** The `vec4u` of a hit's material record. */
export const PT_HIT_MATERIAL_VECS = 3

/** The words of a hit's material record. */
export const PT_HIT_MATERIAL_WORDS = PT_HIT_MATERIAL_VECS * 4

/** The bytes of a hit's material record. */
export const PT_HIT_MATERIAL_BYTES = PT_HIT_MATERIAL_WORDS * 4

/**
 * The `vec4u` a path's material takes in the buffer: the record's `PT_HIT_MATERIAL_VECS`, and where the view's pixels hold several closures (`weighted`) a fourth whose first word is the weight of the slab the shade of the hits
 * chose among the closures, the sum of the closures' weights over the chosen one's (a float, one for a material of one closure). The record itself is the same.
 */
export const ptHitMaterialStride = (weighted: boolean) => PT_HIT_MATERIAL_VECS + (weighted ? 1 : 0)

/** The bytes a path's material takes in the buffer, for the layout in use (the fourth `vec4u` only where `weighted`). */
export const ptHitMaterialSlotBytes = (weighted: boolean) => ptHitMaterialStride(weighted) * 16

/** The bits of a hit's material `flags`: the surface scatters light; its subsurface colour is the transmission of a two-sided leaf; its subsurface colour is added to the diffuse colour. */
export const PT_MATERIAL_FLAG = { scatters: 1, foliage: 2, subsurface: 4 } as const

/** The range the index of refraction is stored over, in an unsigned byte. */
export const PT_IOR_RANGE = { min: 1, max: 3 } as const

/**
 * WHAT THE PATH TRACER KEEPS OF THE MATERIAL AT A HIT (`PtHitMaterial`), the values the material's graph gave at the point
 * (`shadeHitWgsl`-side) in `PT_HIT_MATERIAL_WORDS` words, so that the tracer's lobes read them for every hit, the camera's and the bounces':
 * the base colour and the metalness, the specular, the roughness, the shading normal, the emission, the opacity (one is opaque), the shading model
 * (the number of the graph's `shadingModel` output), the index of refraction, the fuzz of a cloth, the colour a subsurface or a thin
 * transmission takes, the flags (`PT_MATERIAL_FLAG`: bit 0, the surface scatters light, clear for an unlit one that only shows its colour; bits 1 and 2, what the subsurface colour is), the fuzz's colour, the share of the light the material lets through (`transmission`:
 * a surface of one is a glass, the rest of the surfaces are glass in that proportion of their hits), the law of the medium inside it (`attenuation`, `2^(attenuation · distance)` a channel) and the thickness of its walls
 * (none: thin). Words 0 to 5 are half floats and snorms; word 6 packs the model (8 bits), the index of refraction (8 bits over
 * `PT_IOR_RANGE`), the fuzz (8 bits) and the flags (8 bits); word 7 the subsurface colour (three `unorm8`) over the transmission's depth (`unorm8`); words 8 to 11 half floats.
 * `ptPackHitMaterial` writes them, `ptUnpackHitMaterial` reads them.
 */
export const PT_HIT_MATERIAL_WGSL = wgslBlock(
  'PT_HIT_MATERIAL_WGSL',
  [octEncode, octDecode],
  `struct PtHitMaterial{base:vec3f,metallic:f32,specular:f32,roughness:f32,normal:vec3f,emission:vec3f,opacity:f32,model:u32,ior:f32,fuzz:f32,flags:u32,subsurface:vec3f,depth:f32,fuzzColor:vec3f,transmission:f32,attenuation:vec3f,thickness:f32,}
fn ptPackHitMaterial(m:PtHitMaterial)->array<vec4u,${PT_HIT_MATERIAL_VECS}>{
 let ior=u32(round(saturate((m.ior-${PT_IOR_RANGE.min}.0)/${PT_IOR_RANGE.max - PT_IOR_RANGE.min}.0)*255.0));
 let fuzz=u32(round(saturate(m.fuzz)*255.0));
 let s=vec4u(round(saturate(vec4f(m.subsurface,m.depth))*255.0));
 let law=max(m.attenuation,vec3f(-60000.0));
 return array<vec4u,${PT_HIT_MATERIAL_VECS}>(
  vec4u(pack2x16float(m.base.xy),pack2x16float(vec2f(m.base.z,m.metallic)),pack2x16snorm(octEncode(m.normal)),pack2x16unorm(vec2f(m.roughness,m.specular))),
  vec4u(pack2x16float(m.emission.xy),pack2x16float(vec2f(m.emission.z,m.opacity)),(m.model&255u)|(ior<<8u)|(fuzz<<16u)|((m.flags&255u)<<24u),s.x|(s.y<<8u)|(s.z<<16u)|(s.w<<24u)),
  vec4u(pack2x16float(m.fuzzColor.xy),pack2x16float(vec2f(m.fuzzColor.z,m.transmission)),pack2x16float(law.xy),pack2x16float(vec2f(law.z,m.thickness))));
}
fn ptUnpackHitMaterial(a:vec4u,b:vec4u,c:vec4u)->PtHitMaterial{
 var m:PtHitMaterial;
 let c0=unpack2x16float(a.x);
 let c1=unpack2x16float(a.y);
 m.base=vec3f(c0,c1.x);
 m.metallic=c1.y;
 m.normal=octDecode(unpack2x16snorm(a.z));
 let r=unpack2x16unorm(a.w);
 m.roughness=r.x;
 m.specular=r.y;
 let e0=unpack2x16float(b.x);
 let e1=unpack2x16float(b.y);
 m.emission=vec3f(e0,e1.x);
 m.opacity=e1.y;
 m.model=b.z&255u;
 m.ior=${PT_IOR_RANGE.min}.0+f32((b.z>>8u)&255u)*(${PT_IOR_RANGE.max - PT_IOR_RANGE.min}.0/255.0);
 m.fuzz=f32((b.z>>16u)&255u)/255.0;
 m.flags=b.z>>24u;
 m.subsurface=vec3f(f32(b.w&255u),f32((b.w>>8u)&255u),f32((b.w>>16u)&255u))/255.0;
 m.depth=f32(b.w>>24u)/255.0;
 let f0=unpack2x16float(c.x);
 let f1=unpack2x16float(c.y);
 let a0=unpack2x16float(c.z);
 let a1=unpack2x16float(c.w);
 m.fuzzColor=vec3f(f0,f1.x);
 m.transmission=f1.y;
 m.attenuation=vec3f(a0,a1.x);
 m.thickness=a1.y;
 return m;
}`,
)

/** The opaque lobes' `PtSurface` of a hit's material (`ptSurfaceOfHitMaterial`): the diffuse colour is the base colour less what the metal takes (a subsurface material adds its subsurface colour to it, a two-sided leaf keeps it as the colour of the light passing through, `transmit`; either way the two colours are scaled together where they sum over one, `ptTwoSidedBalance`), the reflectance at normal incidence the dielectric's `0.08` times the specular or the base colour where it is metal; the fuzz, the index and the side of the surface the ray met come with it, and the glass pick of the hit is not made yet. */
export const PT_HIT_SURFACE_WGSL = wgslBlock(
  'PT_HIT_SURFACE_WGSL',
  [PT_HIT_MATERIAL_WGSL, SURFACE_F0_WGSL, PT_MATERIAL_WGSL],
  `fn ptTwoSidedBalance(front:ptr<function,vec3f>,back:ptr<function,vec3f>){
 let sum=*front+*back;
 let most=max(sum.x,max(sum.y,sum.z));
 if(most>1.0){
  *front/=most;
  *back/=most;
 }
}
fn ptSurfaceOfHitMaterial(m:PtHitMaterial,position:vec3f,geoNormal:vec3f,vertexNormal:vec3f,hitT:f32,front:bool)->PtSurface{
 var s:PtSurface;
 s.position=position;
 s.geoNormal=geoNormal;
 s.normal=select(-m.normal,m.normal,dot(m.normal,geoNormal)>=0.0);
 s.vertexNormal=select(-vertexNormal,vertexNormal,dot(vertexNormal,geoNormal)>=0.0);
 s.diffuse=m.base*(1.0-m.metallic);
 s.transmit=vec3f(0.0);
 var colour=m.subsurface;
 if((m.flags&${PT_MATERIAL_FLAG.foliage}u)!=0u){
  ptTwoSidedBalance(&s.diffuse,&colour);
  s.transmit=colour;
 }else if((m.flags&${PT_MATERIAL_FLAG.subsurface}u)!=0u){
  ptTwoSidedBalance(&s.diffuse,&colour);
  s.diffuse+=colour;
 }
 surfaceSpecular=m.specular;
 s.f0=surfaceF0(m.base,m.metallic);
 s.roughness=m.roughness;
 s.emission=m.emission;
 s.hitT=hitT;
 s.fuzz=m.fuzz;
 s.fuzzColor=m.fuzzColor;
 s.opacity=m.opacity;
 s.ior=m.ior;
 s.glass=false;
 s.thin=false;
 s.tint=vec3f(1.0);
 s.front=front;
 s.selection=1.0;
 return s;
}`,
)
