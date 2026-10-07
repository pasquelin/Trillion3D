import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { cellReductionWgsl } from '../texture/cellReduction.ts'
import { type ReflectionDepthRead, reflectionPlaneWgsl } from './traceShader.ts'

/** Threads of a reduction workgroup on each axis. */
export const BOUNDS_WORKGROUP = 8

/** Level 0's read of the depth it reduces, and its size: the source's (`ReflectionDepthRead`). */
const DEPTH_SOURCE: ReflectionDepthRead = {
  depthAt: wgslFn(
    'reflectionDepthAt',
    [],
    'fn reflectionDepthAt(p:vec2i)->f32{return textureLoad(source,p,0);}',
  ),
  size: wgslFn('reflectionSize', [], 'fn reflectionSize()->vec2f{return vec2f(extent.xy);}'),
}

/** Level 0's source: the depth, each pixel the range its surface reaches over it
 *  (`reflectionPixelBounds`, the walks' own), `z ± ½(|∂x|+|∂y|)` on the axes its neighbours
 *  continue, so every level bounds a crossing inside any of its pixels; the clear depth holds
 *  none. */
const DEPTH_READ = wgslFn(
  'mipRead',
  [reflectionPlaneWgsl(DEPTH_SOURCE)],
  'fn mipRead(p:vec2i)->vec4f{return vec4f(reflectionPixelBounds(p),0.0,1.0);}',
)

/** A level's read of the one below: its range, as stored. */
const LEVEL_READ = wgslFn(
  'mipRead',
  [],
  'fn mipRead(p:vec2i)->vec4f{return textureLoad(source,p,0);}',
)

/**
 * One level of the reflection's nearest/farthest depth pyramid (`boundsPyramid.ts`): a texel is
 * the range of the source cells it covers — the reduction the radiance levels share
 * (`cellReductionWgsl`, its range: an odd tail folded into the last cell) —, read
 * from the level below, or from the depth for level 0 (`fromDepth`). `extent`: the source's size,
 * then the image's, which the range does not depend on.
 */
const boundsKernel = (fromDepth: boolean) =>
  wgslProgram(
    `
@group(0) @binding(0) var source:${fromDepth ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(1) var<uniform> extent:vec4u;
@group(0) @binding(2) var ranges:texture_storage_2d<rg32float,write>;
@compute @workgroup_size(${BOUNDS_WORKGROUP},${BOUNDS_WORKGROUP}) fn reduceBounds(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=max(extent.xy/2u,vec2u(1u)))){return;}
 textureStore(ranges,vec2i(id.xy),cellReduction(vec2i(id.xy)));
}`,
    [cellReductionWgsl(fromDepth ? DEPTH_READ : LEVEL_READ, { range: true })],
  )

export const REFLECTION_BOUNDS_DEPTH_WGSL = boundsKernel(true)
export const REFLECTION_BOUNDS_LEVEL_WGSL = boundsKernel(false)
