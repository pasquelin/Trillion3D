import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HIZ_OPAQUE_LAYER } from '../gpu/hiz/pyramidTexture.ts'
import { LOBES_DECODE_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_GROUP, reflectionFrontWgsl } from './viewLayout.ts'

/**
 * THE SURFACE THE REFLECTIONS READ, one reading for every kernel (`traceHalf.ts`): a group binds one of
 * each pixel's two surfaces (`halfEncode.ts`) — the opaque one's targets, or the transparents' front
 * one's (`frontLayer.ts`) — and its flags, normal and roughness and lobes are read from it alike. Only
 * the depth differs: `layer` 0 is the opaque one the Hi-Z holds, 1 the front pass's own; every kernel
 * passes its layer as a constant. `reflectingPixelAt`: the surface `layer` at pixel `coord` as every
 * kernel opens it — its point, unit normal, direction to the eye and roughness —, its physical lobes
 * decoded (`lobesAt`) where `flags` carry them; a kernel that weighs no lobe passes no flag.
 */
export const REFLECTION_SURFACES_WGSL = wgslBlock(
  'REFLECTION_SURFACES_WGSL',
  [reflectionFrontWgsl(REFLECTION_GROUP), LOBES_DECODE_WGSL],
  `@group(0) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${B.lobes}) var surfaceLobes:texture_2d<u32>;
fn surfaceFlagsAt(coord:vec2i)->u32{return textureLoad(surfaceFlags,coord,0).r;}
fn surfaceNormalAt(coord:vec2i)->vec4f{return textureLoad(surfaceNormals,coord,0);}
fn surfaceLobesAt(coord:vec2i)->vec4u{return textureLoad(surfaceLobes,coord,0);}
fn surfaceDepthAt(layer:u32,coord:vec2i)->f32{
 if(layer==0u){return textureLoad(hizDepth,coord,${HIZ_OPAQUE_LAYER},0).r;}
 return reflectionFrontDepth(coord);
}
/** The world point of the surface \`layer\` at pixel \`coord\`, at its centre. */
fn surfacePointAt(layer:u32,coord:vec2i)->vec3f{
 return worldAt(vec2f(coord)+vec2f(0.5),surfaceDepthAt(layer,coord));
}
struct ReflectingPixel{P:vec3f,N:vec3f,V:vec3f,rough:f32,}
fn reflectingPixelAt(layer:u32,coord:vec2i,flags:u32)->ReflectingPixel{
 let P=surfacePointAt(layer,coord);
 let normal=surfaceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(surfaceLobesAt(coord),1.0,N,V,normal.a);}
 return ReflectingPixel(P,N,V,normal.a);
}`,
)
