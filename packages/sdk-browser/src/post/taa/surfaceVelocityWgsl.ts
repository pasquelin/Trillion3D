import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from '../../visibility/shader/wpoGraphWgsl.ts'
import { SURFACE_MOTION_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { PAGE_OF_WGSL } from './pageIdWgsl.ts'
import { PIXEL_ANIMATED, TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

/** The velocity stage's bindings: what the velocity passes read, then the vectors written. */
export const SURFACE_VELOCITY_BINDINGS = { ...VELOCITY_INPUT_BINDINGS, vectors: 10 } as const

/**
 * THE VELOCITY STAGE: the motion of each render texel's own surface, drawn once an image before the
 * lighting for every pass that reads it — the indirect light, the depth of field, the temporal
 * pass, the motion blur — into one target, the velocity of the image: the reprojection vector of the
 * surface the texel shows (`encodeOwnVector`), one word a texel, its own motion where the surface
 * moves by itself and measures large enough (`drawsMotion`), else the camera's alone. The word says
 * which (`hasOwnMotion`); a second word holds the flags of its pixel, `PIXEL_ANIMATED` where its
 * surface animates its own pixels together with the responsiveness code its material carries
 * (`pageOf`), and its depth step (`withDepthStep`). No neighbour is read: the passes that dilate it — the temporal pass's
 * analysis (`nearestVelocityWgsl.ts`), the depth of field, the motion blur — each do it with their
 * own rule. One depth load, one identifier load and one reprojection per texel. With `wpo`, the
 * vertices of a surface whose offset is a motion are placed where the offset puts them now and
 * before (`pagePosition`, `pagePreviousPosition`). `waterVelocity` is its second entry: where the single-layer water is
 * nearer than the surface the texel shows (`group(1)`: the depth of the other of the two, the scene's before the water
 * or the water's, the nearer being the water's), the texel's vector is the camera's
 * alone at the water's depth, its flags none — the water's own velocity, which it writes where the reference's
 * water pass writes its velocity (`singleLayerWaterVelocityOutputPass`).
 */
export const surfaceVelocityShader = (wpo: WpoSet = NO_WPO) =>
  wgslProgram(
    `@group(0) @binding(${SURFACE_VELOCITY_BINDINGS.vectors}) var vectorOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn surfaceVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let id=textureLoad(ids,p,0).r;
 let moves=drawsMotion(id);
 let motion=surfaceMotion(screenOfTexel(p),textureLoad(depth,p,0),id,moves);
 let page=pageOf(id);
 let flags=select(0u,${PIXEL_ANIMATED}u,page.animated>0.0)|page.responsive;
 textureStore(vectorOut,p,vec4u(encodeOwnVector(motion.velocity.xy,moves),withDepthStep(flags,motion.velocity.z),0u,0u));
}
@group(1) @binding(0) var waterDepth:texture_depth_2d;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn waterVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let other=textureLoad(waterDepth,p,0);
 let own=textureLoad(depth,p,0);
 if(other==own){return;}
 textureStore(vectorOut,p,vec4u(encodeOwnVector(cameraOnlyMotion(screenOfTexel(p),max(other,own)),false),0u,0u,0u));
}`,
    [PAGE_OF_WGSL, SURFACE_MOTION_WGSL, ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : [])],
  )

/** The velocity stage's program. */
export const SURFACE_VELOCITY_WGSL = surfaceVelocityShader()
