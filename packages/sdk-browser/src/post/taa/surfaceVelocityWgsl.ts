import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NEAREST_SURFACE_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

/** The velocity stage's bindings: what the velocity passes read, then the vectors written. */
export const SURFACE_VELOCITY_BINDINGS = { ...VELOCITY_INPUT_BINDINGS, vectors: 9 } as const

/**
 * THE VELOCITY STAGE: the motion of each render texel, drawn once an image before the lighting for
 * every pass that reads it — the indirect light, the temporal pass, the motion blur — into one
 * target. The nearest surface of the texel (`nearestSurface`, `nearestSurfaceWgsl.ts`) and its
 * reprojection vector, one word a texel (`encodeVector`); the temporal pass's own analysis
 * (`nearestVelocityWgsl.ts`) starts from the same surface and adds the marks and occluders only the
 * history's reprojection reads.
 */
const surfaceVelocityShader = () =>
  wgslProgram(
    `@group(0) @binding(${SURFACE_VELOCITY_BINDINGS.vectors}) var vectorOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn surfaceVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 textureStore(vectorOut,p,vec4u(encodeVector(nearestSurface(p).motion.velocity.xy),0u,0u,0u));
}`,
    [NEAREST_SURFACE_WGSL],
  )

/** The velocity stage's program. */
export const SURFACE_VELOCITY_WGSL = surfaceVelocityShader()
