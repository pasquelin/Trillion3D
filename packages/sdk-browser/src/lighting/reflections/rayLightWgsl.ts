import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
import { makeFinite3 } from '../../../../math/src/wgsl/integer.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogBlockOf } from '../fog/readWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_TRACE_BINDINGS } from './trace/traceBindings.ts'
import { REFLECTION_CLAMP_WGSL } from './field.ts'
import { screenEdgeVignette } from '../../../../math/src/wgsl/projection.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
} from './viewLayout.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { reflectionPastWgsl } from './past.ts'
import { SKY_DIFFUSE_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/** The height fog laid over a radiance seen along a vector from a ray's origin (`heightFogOver`), none where the scene's fog is not a height fog. */
const HEIGHT_FOG_OVER_WGSL = `fn heightFogOver(rgb:vec3f,start:vec3f,along:vec3f)->vec3f{
 if(directLights.fog[${FOG_SLOT.color}].w<${FOG_MODE.exponential - 0.5}){return rgb;}
 let over=heightFogAlong(along,start.y,directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0);
 return rgb*over.a+over.rgb;
}`

/** The height fog laid over a radiance where the reflections' setting allows it (`reflectionFogged`). */
const REFLECTION_RAY_FOG_WGSL = `fn reflectionFogged(rgb:vec3f,start:vec3f,along:vec3f)->vec3f{
 if(!reflectionDone(REFLECTION_HEIGHT_FOG)){return rgb;}
 return heightFogOver(rgb,start,along);
}`

/**
 * THE HEIGHT FOG LAID OVER A RADIANCE (`heightFogOver`): the fog module's text and the read of the fog's own cubemap at `cubemap` and its `sampler` of group 0, over the height fog
 * alone — no local fog volumes' code — lit by the sky light the program binds (`skyLightReadWgsl`). The program that lists it names the lights (`directLights`).
 */
export const heightFogOverWgsl = (cubemap: number, sampler: number) =>
  wgslBlock(
    `heightFogOverWgsl(${cubemap},${sampler})`,
    [
      REFLECTION_CONSTANTS_WGSL,
      fogBlockOf({ group: 0, cubemap, sampler, localFog: false, skyLight: true }),
    ],
    HEIGHT_FOG_OVER_WGSL,
  )

/**
 * THE HEIGHT FOG A RAY'S RADIANCE IS SEEN THROUGH (`reflectionFogged`): the fog module's text and the read of the fog's own cubemap at `cubemap`
 * and its `sampler` of group 0, over the height fog alone — no local fog volumes' code — lit by the sky light that the reflection group binds (`skyLightReadWgsl`).
 * The program that lists it names the lights (`directLights`) and the reflection group.
 */
export const reflectionFogWgsl = (cubemap: number, sampler: number) =>
  wgslBlock(
    `reflectionFogWgsl(${cubemap},${sampler})`,
    [heightFogOverWgsl(cubemap, sampler)],
    REFLECTION_RAY_FOG_WGSL,
  )

/** The lit image a hit may take in place of the cache's light (`reflectionHeld`), with the vignette weight that is the chance it
 *  does (`reflectionHitVignette`) and the noise that weight must reach (`reflectionEdgeNoise`). */
const REFLECTION_RAY_HELD_WGSL = `fn reflectionEdgeNoise(coord:vec2u)->f32{
 return interleavedGradientNoise(vec2f(coord)+vec2f(0.5),f32(reflectionView.temporal.y));
}
/** The last lit image at \`texel\`, one point of its level 0, in the units of a ray's radiance: a channel that is not finite or is negative reads as black. */
fn reflectionLitAt(texel:vec2i)->vec3f{
 return max(makeFinite3(textureLoad(reflectionImage,texel,0).rgb),vec3f(0.0))*reflectionView.radiance.w;
}
fn reflectionHitVignette(S:vec2f,Q:vec2f)->f32{
 return min(screenEdgeVignette(S/view.viewport.xy*2.0-1.0),screenEdgeVignette(Q/reflectionView.radiance.xy*2.0-1.0));
}
fn reflectionHeld(at:vec3f,N:vec3f,noise:f32)->vec4f{
 let none=vec4f(0.0);
 let size=view.viewport.xy;
 if(!reflectionDone(REFLECTION_SCENE_COLOR)||reflectionView.traced.x==0u){return none;}
 let clip=reflectionView.viewProj*vec4f(at,1.0);
 if(clip.w<=0.0){return none;}
 let S=clipToFramebuffer(clip,size);
 if(any(S.xy<vec2f(0.0))||any(S.xy>=size)){return none;}
 let cell=vec2i(S.xy);
 let z=hizOpaqueDepth(cell);
 let depth=surfaceLinearDepth(worldAt(vec2f(cell)+vec2f(0.5),z));
 if(abs(reflectionLinearDepth(clip)-depth)>=reflectionView.light.y*max(depth,0.00001)){return none;}
 if(dot(viewToEye(at),N)<reflectionView.light.z){return none;}
 // Where the surface the hit lands on stood in the last image, and whether that image showed it there.
 let past=reflectionPast(worldAt(S.xy,z),S.xy,z);
 if(!past.valid){return none;}
 let weight=reflectionHitVignette(S.xy,past.pixel);
 if(weight<noise||!reflectionPastAgrees(past,noise,reflectionView.light.y)){return none;}
 return vec4f(reflectionLitAt(reflectionPastTexel(past)),weight);
}`

/** The sky light's diffuse light at the normal N that leaks onto a hit whatever hides it (reflectionSkylightLeak, ReflectionView.leak, none by default). */
export const REFLECTION_SKYLIGHT_LEAK_WGSL = wgslBlock(
  'REFLECTION_SKYLIGHT_LEAK_WGSL',
  [SKY_DIFFUSE_READ_WGSL],
  `fn reflectionSkylightLeak(N:vec3f)->vec3f{
 let leak=reflectionView.leak.xyz*reflectionView.leak.w;
 if(all(leak<=vec3f(0.0))||!skyLit()){return vec3f(0.0);}
 return skyLightDiffuse(N)*leak;
}`,
)

/** What a hit shows (`reflectionSeenAt`), with the sky light leaking onto it (`reflectionSkylightLeak`) and the cone it is read with
 *  (`reflectionHitSpread`). */
const REFLECTION_RAY_SEEN_WGSL = `/** The point a ray's radiance is read from, the surface it leaves (\`reflectionSeenAt\`). */
var<private> reflectionOrigin:vec3f;
/** Whether the lit image held (reflectionHeld) wins the noise of the pixel: it agrees there and its weight reaches the noise. */
fn reflectionHeldWins(held:vec4f,noise:f32)->bool{return held.w>0.0&&held.w>=noise;}
/** What a surface shows given the light radiance the cache gave it and the lit image held where that wins (screen), computed once by the caller. */
fn reflectionSeenFrom(radiance:vec3f,held:vec4f,screen:bool,at:vec3f,N:vec3f)->vec3f{
 let lit=select(radiance,held.rgb,screen)+reflectionSkylightLeak(N);
 return reflectionClampRay(select(reflectionFogged(lit,reflectionOrigin,at-reflectionOrigin),lit,screen));
}
fn reflectionSeenAt(radiance:vec3f,at:vec3f,N:vec3f,coord:vec2u)->vec3f{
 let noise=reflectionEdgeNoise(coord);
 let held=reflectionHeld(at,N,noise);
 return reflectionSeenFrom(radiance,held,reflectionHeldWins(held,noise),at,N);
}
fn reflectionHitSpread(cone:f32)->f32{
 // A cone at or past a right angle spreads over the whole hemisphere: its tangent is held at the greatest f32 angle below a
 // right angle (a footprint far wider than any page, the coarsest read), never let to wrap negative or to infinity.
 return tan(min(reflectionView.eyeSpread+cone,1.5707963));
}`

/**
 * WHAT A RAY BRINGS BACK, once it has found its surface: the radiance it carries, fogged along its length, and the lit
 * image where that agrees with the depth, held to the ceiling of a ray (`reflectionClampRay`, `field.ts`).
 *
 * `reflectionFogged`: a radiance `rgb` seen
 * through the height fog along `along`, the vector from the ray's origin `start` to what it lit — the sky's over the
 * longest of its length and `ReflectionView.light.w` —, where the settings turn it on and the scene's fog is a height
 * fog; the fog module's one law (`heightFogAlong`), read from the origin's height, its colour tinted by the fog's own cubemap along the ray where it has one and the sky light does not light the fog. `reflectionHeld`: the lit image
 * the view holds, in the units of a ray's radiance (the last image's exposure taken out), where a hit at `at`, its face turned to the ray `N`, agrees with it — the depth the image drew
 * there within `ReflectionView.light.y` of its own, its face looking at the eye within the cosine `light.z` — and, as a
 * weight, the vignette (`screenEdgeVignette`) of the hit in this image and in the last, the smaller of the two (`reflectionHitVignette`): the chance the hit takes it; zero
 * elsewhere. `reflectionEdgeNoise`: the interleaved gradient noise of the pixel `coord` at the frame index modulo eight, which a hit's vignette must reach. `reflectionSkylightLeak`: the sky light's diffuse light at the normal `N` of what a ray reaches — the zero vector for a ray
 * that reaches the sky, whose zero normal gives the cube's constant term — that leaks onto it whatever hides it (`ReflectionView.leak`, none by default). `reflectionSeenAt` (`reflectionSeenFrom` where the caller holds the lit image already, as the scene stage does to mark the hits to light again): what a surface
 * the march met shows — the light the surface cache's final lighting gives it at `at`, its face `N`, and the leaking, fogged along the
 * ray from the surface it left (`reflectionOrigin`) — or the lit image where it agrees (`reflectionHeld`) when its weight beats the noise
 * of the pixel the ray is cast from (the weight is the chance it replaces the cache's light), which the screen already fogged and is
 * not fogged again; the leaking is added to either, and the sum held to the ceiling of a ray. The lit image is read where the surface the hit lands
 * on stood in the last image (`reflectionPast`, `past.ts`), and only where the depth the last image kept there is the depth that surface is
 * expected at, within `light.y` of it (`reflectionPastAgrees`). `reflectionHitSpread`: the tangent of the half angle of the cone a hit is read with, the
 * pixel's angle at the eye (none under an orthographic projection) and the ray's cone angle `cone`, in radians. `stored`: how the depth the last image kept is
 * bound (`reflectionPastWgsl`).
 */
export const reflectionRayLightWgsl = (group: number, stored = false) =>
  wgslBlock(
    `reflectionRayLightWgsl(${group},${stored})`,
    [
      reflectionBindingsWgsl(group),
      hizDepthWgsl(group, REFLECTION_DEPTH_BINDING),
      REFLECTION_CONSTANTS_WGSL,
      screenEdgeVignette,
      REFLECTION_CLAMP_WGSL,
      REFLECTION_LINEAR_DEPTH_WGSL,
      makeFinite3,
      reflectionPastWgsl(group, stored),
      REFLECTION_SKYLIGHT_LEAK_WGSL,
      clipToFramebuffer,
      interleavedGradientNoise,
      // The sky light that lights the fog is read on the cube the reflection group already binds (`skyLightReadWgsl`); the fog's own cubemap, which tints it while the sky
      // light does not light it, is the trace's group 0 (`REFLECTION_TRACE_BINDINGS.fogCubemap`).
      reflectionFogWgsl(REFLECTION_TRACE_BINDINGS.fogCubemap, REFLECTION_TRACE_BINDINGS.fogSampler),
    ],
    [REFLECTION_RAY_HELD_WGSL, REFLECTION_RAY_SEEN_WGSL].join('\n'),
  )
