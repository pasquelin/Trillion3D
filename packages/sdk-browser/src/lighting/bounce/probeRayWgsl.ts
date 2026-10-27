import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { surfaceHitWgsl, type SurfaceHitBindings } from '../surfaceCache/hitWgsl.ts'
import { BOUNCE_CM_WGSL } from './tracedHitWgsl.ts'

/** What a world probe's ray answers (`ProbeRay`), the one text both ways of casting the ray share (the centimetres in a metre, the field's unit
 *  the ray's lengths are converted to and the cards are read in, are `BOUNCE_CM`, `tracedHitWgsl.ts`). The answer also says whether the
 *  surface the ray met faces it (`front`) and whether it is `twoSided`; the field has no back faces, so a ray marched through it always meets
 *  the front of a surface. */
export const PROBE_RAY_WGSL = wgslBlock(
  'PROBE_RAY_WGSL',
  [BOUNCE_CM_WGSL],
  `struct ProbeRay{lighting:vec3f,open:f32,distance:f32,steps:u32,front:bool,twoSided:bool,}`,
)

/**
 * THE RAY OF A WORLD PROBE (`probeRay`): the light a ray brings back to the probe it leaves, marched through the global distance field
 * from `begin` to `reach` metres of the world point `origin` along `d`, the first surface it meets giving the light the surface cache
 * holds there (`scGlobalHit`, `../surfaceCache/hitWgsl.ts`: the final lighting, which holds the direct light, the sky and the bounce of the
 * cache's own radiosity). The march is the field's (`gdfTrace`): its step the distance read, its surface expanded by the largest
 * distance read, the ray stopped on a sample no mesh covers by noise drawn at `coord` and the image's turn (`bounce.frame.z`); a ray that
 * starts inside a surface (its hit at or before `begin`) brings back no light. What a ray answers (`ProbeRay`): the light of the
 * surface, whether it left the scene — `open`, 1 when the march met nothing, the caller then reading the sky along it —, and the
 * distance to the surface, `reach` where there is none, and the steps the march took. `side²` rays share the sphere: the width of the cone at the hit. A
 * program that calls it declares the cascades' uniform (`bounce`). Where the scene has acceleration structures the ray is cast through
 * the scene's triangles instead (`probeRayTracedWgsl.ts`), and answers the same.
 */
export const probeRayWgsl = (hit: SurfaceHitBindings) =>
  wgslBlock(
    `probeRayWgsl(${hit.group},${hit.field},${hit.cards})`,
    [PROBE_RAY_WGSL, surfaceHitWgsl(hit)],
    `fn probeRay(origin:vec3f,d:vec3f,begin:f32,reach:f32,side:f32,coord:vec2u)->ProbeRay{
 var out=ProbeRay(vec3f(0.0),1.0,reach,0u,true,false);
 if(gdfView.clipmaps==0u||begin>=reach){return out;}
 let start=origin*f32(BOUNCE_CM);
 let marched=gdfTraceRay(start,d,begin*f32(BOUNCE_CM),reach*f32(BOUNCE_CM),1.0,false,true,coord,f32(bounce.frame.z%8u));
 out.steps=marched.steps;
 if(marched.hitTime<0.0){return out;}
 out.open=0.0;
 out.distance=marched.hitTime/f32(BOUNCE_CM);
 out.lighting=scGlobalHit(start,d,marched,scConeTangent(side),false,begin*f32(BOUNCE_CM),false,vec2u(0u)).radiance;
 return out;
}`,
  )
