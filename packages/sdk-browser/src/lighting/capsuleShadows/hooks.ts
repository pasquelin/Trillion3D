import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { viewDepthOfDevice } from '../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { CAPSULE_CASTER_SURFACE_FLAG } from '../../materials/surface/surfaceModel.ts'
import { CAPSULE_BINDINGS } from './layout.ts'

/**
 * WHAT THE PROGRAMS READ OF THE FRAME: the scene's depth as a distance in metres along the view's axis (`capsuleSceneDepth`, from the depth the
 * frame drew, `hizOpaqueDepth`, turned by the uniform's depth terms) and whether a pixel is of an object that casts an indirect capsule shadow
 * (`capsuleCastsIndirect`, the surface flags the resolve wrote, `CAPSULE_CASTER_SURFACE_FLAG`). The depth is bound in group 0 from
 * `CAPSULE_BINDINGS.depth` (level 0 and the levels uniform, `hizLevelZeroEntries`), the flags at `CAPSULE_BINDINGS.flags`.
 */
export interface CapsuleHooks {
  readonly text: string
  readonly uses: readonly WgslDecl[]
}

/** The hooks over the uniform `terms` names (a vec4f of the depth terms: `CAPSULE_PARAMS.depth`). */
export const capsuleHooks = (terms: string): CapsuleHooks => ({
  uses: [hizDepthWgsl(0, CAPSULE_BINDINGS.depth), viewDepthOfDevice],
  text: `
@group(0) @binding(${CAPSULE_BINDINGS.flags}) var capsuleFlags:texture_2d<u32>;
fn capsuleSceneDepth(pixel:vec2i)->f32{
 let z=hizOpaqueDepth(pixel);
 return viewDepthOfDevice(${terms},z);
}
fn capsuleCastsIndirect(pixel:vec2i)->bool{
 let size=vec2i(textureDimensions(capsuleFlags));
 return (textureLoad(capsuleFlags,clamp(pixel,vec2i(0),size-vec2i(1)),0).r&${CAPSULE_CASTER_SURFACE_FLAG}u)!=0u;
}`,
})
