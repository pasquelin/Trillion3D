import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'
import { f0Of, ndotvClamped, splitSumTerm } from '../../../math/src/wgsl/lighting.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { filteredRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstantsWgsl.ts'
import { MODEL_FLAG } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'

/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE.
 *
 * What a surface reflects along its mirror direction `R`, as one function (`reflectedRadiance`)
 * every program shares — the opaque surfaces in one compute pass (`gpu.ts`), the blended surfaces
 * and the water inline in their fragment stage:
 *
 *  - one ray, marched in screen space through the depth pyramid's NEAREST depths (reversed Z: the
 *    MAXIMUM of a cell, `nearestMips.ts`), coarser while it passes a cell in front of
 *    everything the cell holds, finer when it may meet it, `REFLECTION_STEPS` steps at most;
 *  - at its hit, the previous image's lit colour, reprojected with the view-projection that image
 *    was drawn with, read from that image's box-filtered pyramid at the FRACTIONAL level of the
 *    reflected cone's footprint: 2 · hit distance · tan(half-angle(roughness)), in pixels —
 *    sharp on a mirror, blurred with distance on a rough surface (contact hardening);
 *  - on a miss, off the screen, behind the eye or past the trace's roughness, the environment's
 *    order-2 radiance through the same GGX lobe (`reflectionEnvironment`), the screen colour faded
 *    into it near the image's edges, with the thickness uncertainty and over the trace's roughness
 *    range; where the cone also covers background, the background's share is the environment's.
 *
 * Its weight is the engine's own split-sum term of the GGX lobe (`reflectionWeight`, the rectangle
 * lights' fitted magnitude and Fresnel share): the energy the lights' specular lobe leaves to the
 * environment, never a second model. Nothing of it reads a frame index, a seed or a history of its
 * own: two images of a still view give the same bits.
 */

/** Steps of the hierarchical march, the bound of a ray's cost. */
export const REFLECTION_STEPS = 48
/** Roughness from which the screen trace fades into the environment, and past which only the
 *  environment answers (the compute pass then marches nothing). */
export const REFLECTION_FADE_ROUGHNESS = 0.5
export const REFLECTION_TRACE_ROUGHNESS = 0.7
/** The image border, a fraction of its height, over which a hit fades into the environment. */
export const REFLECTION_EDGE = 1 / 16
/** How far behind the depth a ray may pass and still hit it: a fraction of the view's height at
 *  the hit (its world height under perspective, the view's under an orthographic camera). */
export const REFLECTION_THICKNESS = 1 / 32

const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  `const REFLECTION_STEPS:u32=${REFLECTION_STEPS}u;
const REFLECTION_FADE_ROUGHNESS:f32=${wgslF32(REFLECTION_FADE_ROUGHNESS)};
const REFLECTION_TRACE_ROUGHNESS:f32=${wgslF32(REFLECTION_TRACE_ROUGHNESS)};
const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_THICKNESS:f32=${wgslF32(REFLECTION_THICKNESS)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=0.01;
const REFLECTION_FAR:f32=1e7;`,
)

/**
 * The cone, its level and the fades, pure functions of their arguments.
 *
 * `reflectionConeTangent`: tan of the half-angle of the reflected GGX lobe at `rough` (α = rough²),
 * twice the half-vector's angle at half the distribution's peak — D(θ)/D(0) = ½ gives
 * tan²θ = α²(√2 − 1)/(1 − √2 α²) —, the half-vector's angle bounded at 40°. Zero on a mirror.
 * `reflectionConeLevel`: the pyramid level whose texel spans the cone's diameter `distance` from its
 * apex, `pixel` the world size of one pixel there: log2 of the footprint in pixels, 0 to `top`.
 * `reflectionEdgeFade`: 1 inside the image of `size`, falling smoothly to 0 at its edge over
 * `REFLECTION_EDGE` of its height. `reflectionThicknessFade`: 1 for a ray that meets the depth, 0
 * for one `REFLECTION_THICKNESS` of the view's height `span` behind it, smooth from half of it.
 * `reflectionTraceWeight`: the screen's share by roughness, 1 to `REFLECTION_FADE_ROUGHNESS`, 0 from
 * `REFLECTION_TRACE_ROUGHNESS`.
 */
export const REFLECTION_CONE_WGSL = wgslBlock(
  'REFLECTION_CONE_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionConeTangent(rough:f32)->f32{
 let alpha=rough*rough;let a2=alpha*alpha;
 let h=min(sqrt(a2*(REFLECTION_HALF_MAXIMUM-1.0)/max(1.0-REFLECTION_HALF_MAXIMUM*a2,1e-4)),REFLECTION_CONE_LIMIT);
 return 2.0*h/(1.0-h*h);
}
fn reflectionConeLevel(distance:f32,cone:f32,pixel:f32,top:f32)->f32{
 let footprint=2.0*distance*cone/max(pixel,1e-30);
 return clamp(log2(max(footprint,1.0)),0.0,top);
}
fn reflectionEdgeFade(pixel:vec2f,size:vec2f)->f32{
 let inside=clamp(min(pixel,size-pixel)/(REFLECTION_EDGE*size.y),vec2f(0.0),vec2f(1.0));
 let s=inside*inside*(3.0-2.0*inside);
 return s.x*s.y;
}
fn reflectionThicknessFade(gap:f32,span:f32)->f32{
 let thickness=REFLECTION_THICKNESS*span;
 return 1.0-smoothstep(0.5*thickness,thickness,gap);
}
fn reflectionTraceWeight(rough:f32)->f32{return 1.0-smoothstep(REFLECTION_FADE_ROUGHNESS,REFLECTION_TRACE_ROUGHNESS,rough);}`,
)

/**
 * The GGX lobe's zonal moments for an order-2 radiance field: with z = N·L, its normalized density
 * is z/(1 + k + (k − 1)z)², k = rough⁴; the zonal convolution multiplies bands 0, 1, 2 by E[1],
 * E[z], E[(3z² − 1)/2] — a geometric series below q = ¼ (its tail after twelve terms under 3e-7),
 * the closed form above.
 */
const REFLECTION_BANDS_WGSL = wgslBlock(
  'REFLECTION_BANDS_WGSL',
  [],
  `fn reflectionBands(rough:f32)->vec3f{
 let r2=rough*rough;
 let k=max(r2*r2,1e-8);
 let a=1.0+k;let b=k-1.0;let q=-b/a;
 var moments=vec3f(0.0);
 if(q<0.25){
  var power=1.0;
  for(var index=0;index<12;index++){
   let i=f32(index);moments+=vec3f(1.0/(i+2.0),1.0/(i+3.0),1.0/(i+4.0))*(i+1.0)*power;
   power*=q;
  }
 }else{
  let j0=1.0/(a*(2.0*k));
  let h0=log(2.0*k/a)/b;
  let h1=(1.0-a*h0)/b;
  let h2=(0.5-a*h1)/b;
  let j1=(h0-a*j0)/b;
  let j2=(h1-a*j1)/b;
  let j3=(h2-a*j2)/b;
  moments=vec3f(j1,j2,j3);
 }
 return vec3f(1.0,moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}`,
)

/** The environment's order-2 radiance seen along `R` through the GGX lobe of `rough`: what a
 *  reflection reads where the screen does not answer. The scene's coefficients
 *  (`directLights.environment`), those the diffuse term reads through the cosine lobe. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_BANDS_WGSL],
  `fn reflectionEnvironment(R:vec3f,rough:f32)->vec3f{
 let bands=reflectionBands(rough);
 return max(vec3f(0.0),${filteredRadianceShader((k) => `directLights.environment[${k}].rgb`, 'R', 'bands')});
}`,
)

/** The bind group the reflection's resources take in every program that marches: the opaque
 *  trace's and the forward passes' (`forwardReflectionWgsl`). */
export const REFLECTION_GROUP = 1
/** Bytes of the reflection's view uniform (`ReflectionView`). */
export const REFLECTION_VIEW_BYTES = 256

/**
 * The reflection's resources, in bind group `group`: its view — the depth's view-projection and its
 * inverse, the view-projection the radiance pyramid's image was drawn with, the eye (`w` 0 under an
 * orthographic camera, its direction then), the drawn size and the world size of a pixel at a unit
 * clip `w` (`screen.z`), the radiance image's drawn size and its top level (`radiance.z`), and
 * whether the screen is traced this image (`counts.x`: the depth pyramid holds this image's depth
 * and the radiance pyramid an earlier image of this view) —, the depth pyramid — the Hi-Z's level
 * 0, then its nearest levels (`nearestMips.ts`) —, the radiance pyramid and its trilinear sampler.
 */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [],
    `struct ReflectionView{viewProj:mat4x4f,inverseViewProj:mat4x4f,radianceViewProj:mat4x4f,camera:vec4f,screen:vec4f,radiance:vec4f,counts:vec4u,}
@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(1) var reflectionDepth:texture_2d<f32>;
@group(${group}) @binding(2) var reflectionNearestMips:texture_2d<f32>;
@group(${group}) @binding(3) var reflectionRadiance:texture_2d<f32>;
@group(${group}) @binding(4) var reflectionSampler:sampler;`,
  )

/**
 * The hierarchical march (`reflectionMarch`) of `o + d·t`, `o` in pixels and reversed depth, `t`
 * from 0 to `end`: first out of the origin's own pixel, then from cell to cell of the pyramid
 * (`reflectionNearest`, a cell's nearest depth, clamped to its level). A ray in front of the
 * cell's nearest depth goes to the cell's far side — one level coarser — or, moving away, to that
 * depth's plane if it comes first; a ray at or behind it goes one level finer without moving. It
 * ends below level 0 — `t`, behind the depth of its pixel —, past `end` or after
 * `REFLECTION_STEPS` steps: -1, a miss. A coarse cell holds the nearest of all it covers, so no
 * ray passes through a depth thinner than a pixel; a ray behind a depth stops there, its thickness
 * judged by the caller.
 */
export const REFLECTION_MARCH_WGSL = wgslBlock(
  'REFLECTION_MARCH_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionNearest(cell:vec2i,level:i32)->f32{
 if(level==0){
  let last=vec2i(textureDimensions(reflectionDepth))-vec2i(1);
  return textureLoad(reflectionDepth,clamp(cell,vec2i(0),last),0).r;
 }
 let last=vec2i(textureDimensions(reflectionNearestMips,level-1))-vec2i(1);
 return textureLoad(reflectionNearestMips,clamp(cell,vec2i(0),last),level-1).r;
}
fn reflectionScreenEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(REFLECTION_FAR),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn reflectionMarch(o:vec3f,d:vec3f,end:f32)->f32{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-REFLECTION_NUDGE),vec2f(REFLECTION_NUDGE),ahead);
 let top=i32(textureNumLevels(reflectionNearestMips));
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 var t=min(first.x,first.y);
 var level=0;
 for(var n=0u;n<REFLECTION_STEPS;n++){
  if(level<0||t>end){break;}
  let p=o+d*t;
  let size=exp2(f32(level));
  let cell=floor(p.xy/size);
  let surface=reflectionNearest(vec2i(cell),level);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(exits.x,exits.y);
  let reach=select(REFLECTION_FAR,(surface-o.z)/min(d.z,-1e-30),d.z<0.0);
  let above=p.z>surface;
  if(above){t=min(across,reach);}
  if(above&&across<reach){level=min(level+1,top);}else{level-=1;}
 }
 return select(-1.0,t,level<0&&t<=end);
}`,
)

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects — the one function of every program (see the head of this file).
 * `reflectionSeen` is the screen's answer: the radiance pyramid read at the hit (its colour carries
 * the coverage of the image's drawn pixels, the background's zero), and how much of it holds, the
 * fades multiplied.
 */
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_CONE_WGSL,
      REFLECTION_MARCH_WGSL,
      REFLECTION_ENVIRONMENT_WGSL,
      ROUGHNESS_FLOOR,
      clipToFramebuffer,
      pixelToNdc,
      unprojectPoint,
    ],
    `struct ReflectionSeen{color:vec4f,fade:f32,}
fn reflectionWorldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(reflectionView.inverseViewProj,vec3f(pixelToNdc(pixel,reflectionView.screen.xy),z));
}
fn reflectionSeen(P:vec3f,N:vec3f,R:vec3f,rough:f32)->ReflectionSeen{
 var seen=ReflectionSeen(vec4f(0.0),0.0);
 let size=reflectionView.screen.xy;
 let scale=reflectionView.screen.z;
 // One pixel off the surface along its normal: a ray never starts inside the depth it leaves.
 let origin=P+N*((reflectionView.viewProj*vec4f(P,1.0)).w*scale);
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(R,0.0);
 // The far end: R's vanishing point ahead of the eye (depth 0, at infinity), else where the ray
 // meets the near plane (depth 1); parallel to it, far out of the image.
 var B=toward;
 if(toward.w<=0.0){
  let grow=toward.z-toward.w;
  B=A+toward*select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 }
 let S0=clipToFramebuffer(A,size);
 let d=clipToFramebuffer(B,size)-S0;
 let t=reflectionMarch(S0,d,reflectionScreenEnd(S0.xy,d.xy,size));
 if(t<0.0){return seen;}
 let H=S0+d*t;
 let surface=reflectionNearest(vec2i(floor(H.xy)),0);
 if(surface<=0.0){return seen;}
 let hit=reflectionWorldAt(H.xy,surface);
 let w=(reflectionView.viewProj*vec4f(hit,1.0)).w;
 let gap=distance(reflectionWorldAt(H.xy,H.z),hit);
 let fade=reflectionThicknessFade(gap,w*scale*size.y)*reflectionEdgeFade(H.xy,size);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(fade==0.0||previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy);
 seen.fade=fade*reflectionEdgeFade(Q.xy,reflectionView.radiance.xy);
 if(seen.fade==0.0){return seen;}
 let level=reflectionConeLevel(distance(hit,P),reflectionConeTangent(rough),w*scale,reflectionView.radiance.z);
 seen.color=textureSampleLevel(reflectionRadiance,reflectionSampler,Q.xy/vec2f(textureDimensions(reflectionRadiance)),level);
 return seen;
}
fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32)->vec3f{
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 let R=reflect(-V,N);
 let environment=reflectionEnvironment(R,r);
 let trace=reflectionTraceWeight(r);
 if(trace==0.0||reflectionView.counts.x==0u||dot(N,V)<=0.0){return environment;}
 let seen=reflectionSeen(P,N,R,r);
 let screen=seen.color.rgb+(1.0-clamp(seen.color.a,0.0,1.0))*environment;
 return mix(environment,screen,seen.fade*trace);
}`,
  )

/**
 * What a lit surface keeps of the radiance it reflects: the engine's split-sum term of its GGX lobe
 * at its roughness and N·V (`reflectionWeight`, the fitted magnitude and Fresnel share the rectangle
 * lights read, `ltcLookup`, in every lighting program), on its reflectance; a clear coat adds its own dielectric lobe on its
 * normal and roughness, the environment's, and lets the base through as it lets every other term
 * (`lobeReflection`). A program without lobes passes the base as it is.
 */
export const reflectionWeightWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionWeightWgsl(${lobes})`,
    [REFLECTION_ENVIRONMENT_WGSL, splitSumTerm, f0Of, ndotvClamped, ROUGHNESS_FLOOR],
    `fn reflectionWeight(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 return splitSumTerm(f0Of(rgb,metal),ltcLookup(clamp(rough,ROUGHNESS_FLOOR,1.0),ndotvClamped(N,V),1u));
}
/** Whether the surface model has a specular lobe: the diffuse and toon models have none. */
fn reflects()->bool{return surfaceModel!=${MODEL_FLAG.diffuse}u&&surfaceModel!=${MODEL_FLAG.toon}u;}
${
  lobes
    ? `fn lobeReflection(m:vec3f,V:vec3f)->vec3f{
 if(!lobes.on){return m;}
 var coat=vec3f(0.0);
 if(lobes.coat>0.0){
  let r=clamp(lobes.coatRough,ROUGHNESS_FLOOR,1.0);
  coat=lobes.coat*reflectionEnvironment(reflect(-V,lobes.coatN),r)*reflectionWeight(vec3f(0.0),0.0,r,lobes.coatN,V);
 }
 return m*lobes.through+coat;
}`
    : 'fn lobeReflection(m:vec3f,V:vec3f)->vec3f{return m;}'
}`,
  )

/** A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 *  bind group `group`. */
export const forwardReflectionWgsl = (group: number, lobes: boolean) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes})`,
    [reflectedRadianceWgsl(group), reflectionWeightWgsl(lobes)],
    `fn surfaceReflection(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return lobeReflection(reflectedRadiance(P,N,V,rough)*reflectionWeight(rgb,metal,rough,N,V),V);
}`,
  )

/** The opaque resolve's binding of the reflection target the compute pass wrote (`gpu.ts`). */
export const REFLECTION_TARGET_BINDING = 33
/** The reflection target, read by load alone by the opaque resolve. */
export const REFLECTION_TARGET = loadOnlyTarget(
  REFLECTION_TARGET_BINDING,
  'rgba16float',
  'reflectionTarget',
)

/** The opaque resolve's reflection: the radiance the compute pass traced for its pixel, weighted
 *  as a forward program weighs its own (`reflectionWeightWgsl`). */
export const resolvedReflectionWgsl = (lobes: boolean) =>
  wgslBlock(
    `resolvedReflectionWgsl(${lobes})`,
    [reflectionWeightWgsl(lobes)],
    `${REFLECTION_TARGET.wgsl}
fn resolvedReflection(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return lobeReflection(textureLoad(reflectionTarget,coord).rgb*reflectionWeight(rgb,metal,rough,N,V),V);
}`,
  )
