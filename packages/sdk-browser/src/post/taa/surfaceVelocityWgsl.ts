import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SURFACE_MOTION_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

/** The velocity stage's bindings: what the velocity passes read, then the vectors written. */
export const SURFACE_VELOCITY_BINDINGS = { ...VELOCITY_INPUT_BINDINGS, vectors: 10 } as const

/**
 * THE VELOCITY STAGE: the motion of each render texel's own surface, drawn once an image before the
 * lighting for every pass that reads it — the indirect light, the depth of field, the temporal
 * pass, the motion blur — into one target, the velocity of the image: the reprojection vector of the
 * surface the texel shows (`encodeOwnVector`), one word a texel, its own motion where the surface
 * moves by itself and measures large enough (`drawsMotion`), else the camera's alone. The word says
 * which (`hasOwnMotion`). No neighbour is read: the passes that dilate it — the temporal pass's
 * analysis (`nearestVelocityWgsl.ts`), the depth of field, the motion blur — each do it with their
 * own rule. One depth load, one identifier load and one reprojection per texel.
 */
const surfaceVelocityShader = () =>
  wgslProgram(
    `@group(0) @binding(${SURFACE_VELOCITY_BINDINGS.vectors}) var vectorOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn surfaceVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let id=textureLoad(ids,p,0).r;
 let moves=drawsMotion(id);
 let motion=surfaceMotion(screenOfTexel(p),textureLoad(depth,p,0),id,moves);
 textureStore(vectorOut,p,vec4u(encodeOwnVector(motion.velocity.xy,moves),0u,0u,0u));
}`,
    [SURFACE_MOTION_WGSL],
  )

/** The velocity stage's program. */
export const SURFACE_VELOCITY_WGSL = surfaceVelocityShader()
