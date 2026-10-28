import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TAA_VIEW_WGSL } from '../../post/taa/bindingsWgsl.ts'
import { VOLUME_VELOCITY_WGSL } from '../../post/taa/volumeVelocity.ts'

/**
 * THE VELOCITY OF A VOLUME (`r.HeterogeneousVolumes.Velocity`, HeterogeneousVolumesLiveShadingPipeline.usf:842-855): the
 * pixel where a volume becomes opaque (its opacity crosses one half with this volume, and the point where the ray first meets
 * extinction lies inside the span) writes the velocity of that point into the vectors the temporal pass reads, replacing the
 * texel (a store, no merge). The velocity is the point's screen position now (the pixel's, as the point is on its ray) less
 * the one the last image's camera gave it, and the step of its device depth.
 *
 * The reference marks the scatter point inside its march only in a branch it compiles out (`#if 0`,
 * HeterogeneousVolumesRayMarchingUtils.ush:497-501), so its condition `ScatterHitT < HitT.y` never holds in the live shading
 * and it writes no velocity there; here the point is the first with extinction (declared). The program declares hvVelocity
 * (a storage texture of the vectors), hvTaa (the temporal pass's view uniform, `TaaView`), and hvView.flags.w, whether the
 * image writes velocity.
 */
export const HV_VELOCITY_WGSL = wgslBlock(
  'HV_VELOCITY_WGSL',
  [TAA_VIEW_WGSL, VOLUME_VELOCITY_WGSL],
  `
fn hvWriteVelocity(viewPixel:vec2u,world:vec3f){
 if(hvView.flags.w==0u||any(vec2f(viewPixel)>=hvTaa.render.xy)){return;}
 let before=hvTaa.prevViewProj*vec4f(world-hvView.eye.xyz,1.0);
 if(before.w<=0.0){return;}
 let last=before.xyz/before.w;
 let now=hvView.viewProj*vec4f(world,1.0);
 let screen=vec2f(1.0,-1.0)*((vec2f(viewPixel)+vec2f(0.5))*hvTaa.render.zw*2.0-vec2f(1.0));
 let word=volumeVelocityWord(screen-last.xy,now.z/now.w-last.z);
 textureStore(hvVelocity,vec2i(viewPixel),vec4u(word.x,word.y,0u,0u));
}
`,
)
