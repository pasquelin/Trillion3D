import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogBlockOf } from '../fog/readWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CLAMP_WGSL, REFLECTION_CONE_WGSL } from './field.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
} from './viewLayout.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'

/**
 * WHAT A RAY BRINGS BACK, once it has found its surface: the radiance it carries, fogged along its length, and the lit
 * image where that agrees with the depth, held to the ceiling of a ray (`reflectionClampRay`, `field.ts`).
 *
 * `reflectionFogged`: a radiance `rgb` seen
 * through the height fog along `along`, the vector from the ray's origin `start` to what it lit — the sky's over the
 * longest of its length and `ReflectionView.light.w` —, where the settings turn it on and the scene's fog is a height
 * fog; the fog module's one law (`heightFogAlong`), read from the origin's height. `reflectionHeld`: the lit image
 * the view holds, where a hit at `at`, its face turned to the ray `N`, agrees with it — the depth the image drew
 * there within `ReflectionView.light.y` of its own, its face looking at the eye within the cosine `light.z` — and, as a
 * weight, how far from the edge of this image and the last it lies (the stochastic acceptance's expectation); zero
 * elsewhere. `reflectionSeenAt`: what a surface of the proxy not lit by the lights shows — its tint under the light
 * the probes hold, its emission, fogged along the ray from the surface it left (`reflectionOrigin`) — over the lit
 * image where it agrees (`reflectionHeld`), which the screen already fogged; the proxy walk's reading of every layer
 * it meets (`runtimeRadianceWgsl`). The history's own depth is not read: the image holds none of its own.
 */
export const reflectionRayLightWgsl = (group: number) =>
  wgslBlock(
    `reflectionRayLightWgsl(${group})`,
    [
      reflectionBindingsWgsl(group),
      hizDepthWgsl(group, REFLECTION_DEPTH_BINDING),
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_CONE_WGSL,
      REFLECTION_CLAMP_WGSL,
      REFLECTION_LINEAR_DEPTH_WGSL,
      clipToFramebuffer,
      fogBlockOf({ group: 0 }),
    ],
    `fn reflectionFogged(rgb:vec3f,start:vec3f,along:vec3f)->vec3f{
 if(!reflectionDone(REFLECTION_HEIGHT_FOG)||directLights.fog[${FOG_SLOT.color}].w<${FOG_MODE.exponential - 0.5}){return rgb;}
 let over=heightFogAlong(along,start.y,directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0);
 return rgb*over.a+over.rgb;
}
fn reflectionHeld(at:vec3f,N:vec3f)->vec4f{
 let none=vec4f(0.0);
 let size=view.viewport.xy;
 if(!reflectionDone(REFLECTION_SCENE_COLOR)||reflectionView.traced.x==0u){return none;}
 let clip=reflectionView.viewProj*vec4f(at,1.0);
 if(clip.w<=0.0){return none;}
 let S=clipToFramebuffer(clip,size);
 if(any(S.xy<vec2f(0.0))||any(S.xy>=size)){return none;}
 let cell=vec2i(S.xy);
 let depth=surfaceLinearDepth(worldAt(vec2f(cell)+vec2f(0.5),hizOpaqueDepth(cell)));
 if(abs(reflectionLinearDepth(clip)-depth)>=reflectionView.light.y*max(depth,0.00001)){return none;}
 if(dot(viewToEye(at),N)<reflectionView.light.z){return none;}
 let previous=reflectionView.radianceViewProj*vec4f(at,1.0);
 if(previous.w<=0.0){return none;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let weight=reflectionEdgeFade(S.xy,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let lit=textureLoad(reflectionImage,vec2i(Q),0);
 return vec4f(lit.rgb,weight*clamp(lit.a,0.0,1.0));
}
fn reflectionSeenAt(tint:vec3f,emission:vec3f,at:vec3f,N:vec3f)->vec3f{
 let proxied=reflectionFogged(surfaceSeen(tint,at,N)+emission,reflectionOrigin,at-reflectionOrigin);
 let held=reflectionHeld(at,N);
 return reflectionClampRay(mix(proxied,held.rgb,held.w));
}`,
  )
