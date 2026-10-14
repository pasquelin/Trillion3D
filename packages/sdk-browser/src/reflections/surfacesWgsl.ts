import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HIZ_OPAQUE_LAYER } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_GROUP, reflectionFrontWgsl } from './viewLayout.ts'

/**
 * THE SURFACES THE REFLECTIONS READ, one reading for the trace and the upsample (`traceHalf.ts`): each
 * pixel's two surfaces, `layer` 0 the opaque one — the surface targets and the depth the Hi-Z holds of
 * it — and 1 the transparents' front one (`frontLayer.ts`), its own targets and depth: the flags, the
 * normal and roughness, the depth and the lobes of the surface `layer` at a pixel. Every kernel passes
 * its layer as a constant, so each reads one surface's textures.
 */
export const REFLECTION_SURFACES_WGSL = wgslBlock(
  'REFLECTION_SURFACES_WGSL',
  [reflectionFrontWgsl(REFLECTION_GROUP)],
  `@group(0) @binding(${B.flags}) var traceFlags:texture_2d<u32>;
@group(0) @binding(${B.normals}) var traceNormals:texture_2d<f32>;
@group(0) @binding(${B.lobes}) var traceLobes:texture_2d<u32>;
@group(0) @binding(${B.frontFlags}) var frontFlags:texture_2d<u32>;
@group(0) @binding(${B.frontNormals}) var frontNormals:texture_2d<f32>;
@group(0) @binding(${B.frontLobes}) var frontLobes:texture_2d<u32>;
fn surfaceFlagsAt(layer:u32,coord:vec2i)->u32{
 if(layer==0u){return textureLoad(traceFlags,coord,0).r;}
 return textureLoad(frontFlags,coord,0).r;
}
fn surfaceNormalAt(layer:u32,coord:vec2i)->vec4f{
 if(layer==0u){return textureLoad(traceNormals,coord,0);}
 return textureLoad(frontNormals,coord,0);
}
fn surfaceDepthAt(layer:u32,coord:vec2i)->f32{
 if(layer==0u){return textureLoad(hizDepth,coord,${HIZ_OPAQUE_LAYER},0).r;}
 return reflectionFrontDepth(coord);
}
fn surfaceLobesAt(layer:u32,coord:vec2i)->vec4u{
 if(layer==0u){return textureLoad(traceLobes,coord,0);}
 return textureLoad(frontLobes,coord,0);
}
/** The world point of the surface \`layer\` at pixel \`coord\`, at its centre. */
fn surfacePointAt(layer:u32,coord:vec2i)->vec3f{
 return worldAt(vec2f(coord)+vec2f(0.5),surfaceDepthAt(layer,coord));
}`,
)
