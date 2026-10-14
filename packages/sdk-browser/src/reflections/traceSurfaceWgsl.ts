import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HIZ_OPAQUE_LAYER } from '../gpu/hiz/pyramidTexture.ts'
import { runtimeAnswerWgsl } from '../bounce/runtimeAnswerWgsl.ts'
import { RUNTIME_BINDINGS, TRACE_BINDINGS } from './traceBindings.ts'
import { REFLECTION_GROUP, reflectionFrontWgsl } from './viewLayout.ts'

/**
 * THE SURFACES THE TRACE READS, one reading for its two kernels (`trace.ts`): each pixel's two surfaces
 * (`rtLayer`) — the opaque one, the surface targets and the depth the Hi-Z holds of it, and the
 * transparents' front one (`frontLayer.ts`), its own targets and depth —, the flags, the normal and
 * roughness, the depth and the lobes of the surface `rtLayer`. The front surface is read only where this
 * image's trace answers it (`reflectionFrontTraced`).
 */
export const TRACE_SURFACE_WGSL = wgslBlock(
  'TRACE_SURFACE_WGSL',
  [reflectionFrontWgsl(REFLECTION_GROUP), runtimeAnswerWgsl(RUNTIME_BINDINGS)],
  `@group(0) @binding(${TRACE_BINDINGS.flags}) var traceFlags:texture_2d<u32>;
@group(0) @binding(${TRACE_BINDINGS.normals}) var traceNormals:texture_2d<f32>;
@group(0) @binding(${TRACE_BINDINGS.lobes}) var traceLobes:texture_2d<u32>;
@group(0) @binding(${TRACE_BINDINGS.frontFlags}) var frontFlags:texture_2d<u32>;
@group(0) @binding(${TRACE_BINDINGS.frontNormals}) var frontNormals:texture_2d<f32>;
@group(0) @binding(${TRACE_BINDINGS.frontLobes}) var frontLobes:texture_2d<u32>;
fn traceFlagsAt(coord:vec2i)->u32{
 if(rtLayer==0u){return textureLoad(traceFlags,coord,0).r;}
 return textureLoad(frontFlags,coord,0).r;
}
fn traceNormalAt(coord:vec2i)->vec4f{
 if(rtLayer==0u){return textureLoad(traceNormals,coord,0);}
 return textureLoad(frontNormals,coord,0);
}
fn traceDepthAt(coord:vec2i)->f32{
 if(rtLayer==0u){return textureLoad(hizDepth,coord,${HIZ_OPAQUE_LAYER},0).r;}
 return reflectionFrontDepth(coord);
}
fn traceLobesAt(coord:vec2i)->vec4u{
 if(rtLayer==0u){return textureLoad(traceLobes,coord,0);}
 return textureLoad(frontLobes,coord,0);
}`,
)
