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
 * What a surface reflects along its mirror direction `R` is one function (`reflectedRadiance`)
 * every program shares — the opaque surfaces in one compute pass (`gpu.ts`), the blended surfaces
 * and the water inline in their fragment stage. It reads three things of the view: its depth, the
 * previous lit image of the same view, and the radiance around the scene.
 *
 * The depth is a field of slabs (`depth.ts`). A pixel holds its centre's depth, the surface runs
 * through it on its plane (the slope rule of every depth reader, `surfaceSlopeOf`), and the slab
 * behind that plane is `REFLECTION_THICKNESS` of the view's height deep at its distance: what the
 * image cannot see behind a surface is taken to be that thick. Coarser cells bound the slabs they
 * cover (`reflectionBounds`: their nearest, and their farthest once the pyramid keeps one). A ray
 * leaves the surface one pixel off it along its normal and is marched in screen space from its own
 * pixel (`reflectionMarch`): past a cell it lies in front of, one level coarser; past a cell whose
 * every slab it lies behind; else one level finer, down to a pixel, where the segment it spans there
 * is judged against that pixel's slab — in front of the plane at both ends, or behind the slab at
 * both, it passes on; else it hits at the segment's first point inside the slab. A ray skimming a
 * surface seen edge-on thus never stops on the pixel centres it passes in front of, nor a ray
 * passing behind a thin object on it. `REFLECTION_STEPS` steps bound a ray.
 *
 * A hit reads the previous image, reprojected with the view-projection it was drawn with, from its
 * filtered pyramid (`gpu.ts`) over the reflected lobe's footprint there (`reflectionFootprint`): an
 * ellipse whose axes are 2 · hit distance · tan of the GGX lobe's half-maximum angle
 * (`reflectionConeTangent`) at the lobe's two widths — equal on an isotropic material —, its long
 * axis along the lobe's stretched direction as the image shows it. The pyramid level is the short
 * axis's, read smooth between and within levels (`reflectionRadianceAt`), and up to
 * `REFLECTION_TAPS` taps cover the long axis: one tap on a round footprint, sharp on a mirror,
 * blurred with distance on a rough surface. How far behind the plane the hit lies, and how near the
 * image's edges, fade it into the radiance around the scene.
 *
 * That radiance (`reflectionEnvironment`) is the environment the diffuse lighting reads — its
 * order-2 coefficients through the GGX lobe of the roughness —, plus, in a scene that declares no
 * light around it, the background the view shows (`surroundings`, `gpu.ts`): a mirror shows it as
 * the eye sees it. It answers a miss, a surface past the trace's roughness, and the uncovered share
 * of a footprint.
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
/** The depth of a pixel's slab: a fraction of the view's height at its distance (its world height
 *  under perspective, the view's under an orthographic camera). */
export const REFLECTION_THICKNESS = 1 / 32
/** The taps of a footprint along its long axis at most: past that ratio of its axes, the level is
 *  the long axis's share of a tap. */
export const REFLECTION_TAPS = 5

const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  `const REFLECTION_STEPS:u32=${REFLECTION_STEPS}u;
const REFLECTION_FADE_ROUGHNESS:f32=${wgslF32(REFLECTION_FADE_ROUGHNESS)};
const REFLECTION_TRACE_ROUGHNESS:f32=${wgslF32(REFLECTION_TRACE_ROUGHNESS)};
const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_THICKNESS:f32=${wgslF32(REFLECTION_THICKNESS)};
const REFLECTION_TAPS:f32=${wgslF32(REFLECTION_TAPS)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=0.01;
const REFLECTION_FAR:f32=1e7;`,
)

/**
 * The cone and the fades, pure functions of their arguments.
 *
 * `reflectionConeTangent`: tan of the half-angle of the reflected GGX lobe of width `alpha`
 * (rough², or a stretched lobe's α along its direction), twice the half-vector's angle at half the
 * distribution's peak — D(θ)/D(0) = ½ gives tan²θ = α²(√2 − 1)/(1 − √2 α²) —, the half-vector's
 * angle bounded at 40°. Zero on a mirror.
 * `reflectionEdgeFade`: 1 inside the image of `size`, falling smoothly to 0 at its edge over
 * `REFLECTION_EDGE` of its height. `reflectionThicknessFade`: 1 for a hit on the plane, 0 for one
 * `thickness` behind it, smooth from half of it.
 * `reflectionTraceWeight`: the screen's share by roughness, 1 to `REFLECTION_FADE_ROUGHNESS`, 0 from
 * `REFLECTION_TRACE_ROUGHNESS`.
 */
export const REFLECTION_CONE_WGSL = wgslBlock(
  'REFLECTION_CONE_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionConeTangent(alpha:f32)->f32{
 let a2=alpha*alpha;
 let h=min(sqrt(a2*(REFLECTION_HALF_MAXIMUM-1.0)/max(1.0-REFLECTION_HALF_MAXIMUM*a2,1e-4)),REFLECTION_CONE_LIMIT);
 return 2.0*h/(1.0-h*h);
}
fn reflectionEdgeFade(pixel:vec2f,size:vec2f)->f32{
 let inside=clamp(min(pixel,size-pixel)/(REFLECTION_EDGE*size.y),vec2f(0.0),vec2f(1.0));
 let s=inside*inside*(3.0-2.0*inside);
 return s.x*s.y;
}
fn reflectionThicknessFade(gap:f32,thickness:f32)->f32{
 return 1.0-smoothstep(0.5*thickness,thickness,gap);
}
fn reflectionTraceWeight(rough:f32)->f32{return 1.0-smoothstep(REFLECTION_FADE_ROUGHNESS,REFLECTION_TRACE_ROUGHNESS,rough);}`,
)

/**
 * The reflection's view (`ReflectionView`, `writeReflectionView` in `gpu.ts`): the depth's
 * view-projection and its inverse, the view-projection the radiance pyramid's image was drawn
 * with, the eye (`w` 0 under an orthographic camera, its direction then), the drawn size and the
 * world size of a pixel at a unit clip `w` (`screen.z`), the radiance image's drawn size and its
 * top level (`radiance.z`), whether the screen is traced this image (`counts.x`: the depth pyramid
 * holds this image's depth and the radiance pyramid an earlier image of this view) and the display
 * curve's rank (`counts.y`), the background as the display shows it, in linear, and the exposure
 * (`display`), and the radiance around the scene a miss adds to the environment's (`surroundings`,
 * written on the GPU from them).
 */
export const REFLECTION_VIEW_WGSL = wgslBlock(
  'REFLECTION_VIEW_WGSL',
  [],
  'struct ReflectionView{viewProj:mat4x4f,inverseViewProj:mat4x4f,radianceViewProj:mat4x4f,camera:vec4f,screen:vec4f,radiance:vec4f,counts:vec4u,display:vec4f,surroundings:vec4f,}',
)
/** Bytes of the reflection's view uniform (`ReflectionView`). */
export const REFLECTION_VIEW_BYTES = 288
/** Bytes of it the CPU writes: all but `surroundings`, which the GPU writes. */
export const REFLECTION_VIEW_WRITTEN_BYTES = 272

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

/** The radiance around the scene seen along `R` through the GGX lobe of `rough`: the environment's
 *  order-2 coefficients the diffuse term reads through the cosine lobe (`directLights.environment`),
 *  and the uniform radiance the view's `surroundings` add, which every band-0 filter keeps whole. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_BANDS_WGSL, REFLECTION_VIEW_WGSL],
  `fn reflectionEnvironment(R:vec3f,rough:f32)->vec3f{
 let bands=reflectionBands(rough);
 return max(vec3f(0.0),${filteredRadianceShader((k) => `directLights.environment[${k}].rgb`, 'R', 'bands')})+reflectionView.surroundings.rgb;
}`,
)

/** The bind group the reflection's resources take in every program that marches: the opaque
 *  trace's and the forward passes' (`forwardReflectionWgsl`). */
export const REFLECTION_GROUP = 1

/** The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the depth
 *  it marches — the field, then its nearest levels (`depth.ts`) —, the radiance pyramid and its
 *  trilinear sampler. */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [REFLECTION_VIEW_WGSL],
    `@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(1) var reflectionDepth:texture_2d<u32>;
@group(${group}) @binding(2) var reflectionDepthLevels:texture_2d<f32>;
@group(${group}) @binding(3) var reflectionRadiance:texture_2d<f32>;
@group(${group}) @binding(4) var reflectionSampler:sampler;`,
  )

/**
 * The view's geometry: the world point of a pixel at a depth (`reflectionWorldAt`), the direction
 * from a point to the eye (`reflectionToEye`), the slab's depth at a world point
 * (`reflectionThickness`: `REFLECTION_THICKNESS` of the view's height at its clip `w`) and the depth
 * of the slab's back behind the depth `z` at the pixel point `q` (`reflectionSlabBack`).
 */
const REFLECTION_GEOMETRY_WGSL = wgslBlock(
  'REFLECTION_GEOMETRY_WGSL',
  [REFLECTION_CONSTANTS_WGSL, pixelToNdc, unprojectPoint],
  `fn reflectionWorldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(reflectionView.inverseViewProj,vec3f(pixelToNdc(pixel,reflectionView.screen.xy),z));
}
fn reflectionToEye(P:vec3f)->vec3f{return normalize(reflectionView.camera.xyz-P*reflectionView.camera.w);}
fn reflectionThickness(P:vec3f)->f32{
 return REFLECTION_THICKNESS*(reflectionView.viewProj*vec4f(P,1.0)).w*reflectionView.screen.z*reflectionView.screen.y;
}
fn reflectionSlabBack(q:vec2f,z:f32)->f32{
 let P=reflectionWorldAt(q,z);
 let back=reflectionView.viewProj*vec4f(P-reflectionToEye(P)*reflectionThickness(P),1.0);
 return back.z/back.w;
}`,
)

/**
 * The march (see the head of this file) of `o + d·t`, `o` in pixels and reversed depth, `t` from 0
 * to `end` (`reflectionScreenEnd`: the image's edge, or the ray's far end). A cell's bounds are its
 * farthest and nearest depths: a pixel's plane over the pixel (`reflectionPixel`, its depth and
 * slopes); a coarser cell's nearest slab, and the background's 0 as its farthest until the pyramid
 * keeps one (`reflectionBounds`). Moving away, a ray in front of a cell goes no farther than that
 * cell's nearest depth before it looks finer. The hit is the first point of a pixel's segment
 * inside its slab — its entry, where it crosses the plane, or where it comes out of the slab's back
 * —, returned as its `t` and the plane's depth there (`ReflectionHit`); `t` -1 on a miss: past
 * `end`, past the steps, or on the background.
 */
export const REFLECTION_MARCH_WGSL = wgslBlock(
  'REFLECTION_MARCH_WGSL',
  [REFLECTION_CONSTANTS_WGSL, REFLECTION_GEOMETRY_WGSL],
  `struct ReflectionHit{t:f32,depth:f32,}
fn reflectionPixel(cell:vec2i)->vec3f{
 let last=vec2i(textureDimensions(reflectionDepth))-vec2i(1);
 let texel=textureLoad(reflectionDepth,clamp(cell,vec2i(0),last),0);
 let z=bitcast<f32>(texel.x);
 return vec3f(z,unpack2x16float(texel.y)*z);
}
fn reflectionBounds(cell:vec2i,level:i32)->vec2f{
 let last=vec2i(textureDimensions(reflectionDepthLevels,level-1))-vec2i(1);
 return vec2f(0.0,textureLoad(reflectionDepthLevels,clamp(cell,vec2i(0),last),level-1).r);
}
fn reflectionScreenEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(REFLECTION_FAR),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn reflectionMarch(o:vec3f,d:vec3f,end:f32)->ReflectionHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-REFLECTION_NUDGE),vec2f(REFLECTION_NUDGE),ahead);
 let top=i32(textureNumLevels(reflectionDepthLevels));
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 var t=min(first.x,first.y);
 var level=0;
 for(var n=0u;n<REFLECTION_STEPS;n++){
  if(t>end){break;}
  var p=o+d*t;
  let size=exp2(f32(level));
  let cell=floor(p.xy/size);
  var pixel=vec3f(0.0);
  var bounds:vec2f;
  if(level==0){
   pixel=reflectionPixel(vec2i(cell));
   let extent=0.5*(abs(pixel.y)+abs(pixel.z));
   bounds=vec2f(pixel.x-extent,pixel.x+extent);
  }else{bounds=reflectionBounds(vec2i(cell),level);}
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(exits.x,exits.y);
  if(p.z>bounds.y){
   let reach=select(REFLECTION_FAR,(bounds.y-o.z)/min(d.z,-1e-30),d.z<0.0);
   if(across<reach){t=across;level=min(level+1,top);continue;}
   t=reach;p=o+d*t;
  }
  let q=o+d*across;
  if(level>0){
   if(bounds.x>0.0&&max(p.z,q.z)<reflectionSlabBack((cell+vec2f(0.5))*size,bounds.x)){t=across;}
   else{level-=1;}
   continue;
  }
  if(pixel.x<=0.0){break;}
  let centre=cell+vec2f(0.5);
  let deep=pixel.x-reflectionSlabBack(centre,pixel.x);
  let enter=p.z-pixel.x-dot(p.xy-centre,pixel.yz);
  let leave=q.z-pixel.x-dot(q.xy-centre,pixel.yz);
  if(min(enter,leave)>0.0||max(enter,leave)< -deep){t=across;continue;}
  let f=select(select(0.0,(enter+deep)/(enter-leave),enter< -deep),enter/(enter-leave),enter>0.0);
  let h=t+(across-t)*f;
  if(h>end){break;}
  return ReflectionHit(h,pixel.x+dot((o+d*h).xy-centre,pixel.yz));
 }
 return ReflectionHit(-1.0,0.0);
}`,
)

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects — the one function of every program (see the head of this file). `lobe` is the
 * lobe's long axis: its direction (`xyz`, any on a round lobe) and its α along it (`w`; rough² on a
 * round lobe), the material's anisotropic GGX parameters (`reflectionLobe`). `reflectionSeen` is the
 * screen's answer: the footprint's colour (`reflectionFootprint`; it carries the coverage of the
 * image's drawn pixels, the background's zero) and how much of it holds, the fades multiplied.
 * `reflectionRadianceAt` reads the pyramid at a fractional level, between its two levels: level 0,
 * the image itself, as the sampler interpolates it, sharp; a coarser one, a filtered stand-in, as
 * a cubic B-spline of its texels (`reflectionLevelRead`: four bilinear reads), smooth, so that a
 * blurred reflection is a round blob at every level, never a texel's square.
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
    ],
    `struct ReflectionSeen{color:vec4f,fade:f32,}
fn reflectionLevelRead(uv:vec2f,level:f32)->vec4f{
 if(level==0.0){return textureSampleLevel(reflectionRadiance,reflectionSampler,uv,0.0);}
 let size=vec2f(textureDimensions(reflectionRadiance,u32(level)));
 let t=uv*size-vec2f(0.5);let i=floor(t);let f=t-i;
 let f2=f*f;let f3=f2*f;let e=vec2f(1.0)-f;
 let w0=e*e*e/6.0;let w1=(vec2f(4.0)-6.0*f2+3.0*f3)/6.0;let w3=f3/6.0;let w2=vec2f(1.0)-w0-w1-w3;
 let g0=w0+w1;let g1=w2+w3;
 let low=(i-vec2f(0.5)+w1/g0)/size;let high=(i+vec2f(1.5)+w3/g1)/size;
 let s=textureSampleLevel(reflectionRadiance,reflectionSampler,low,level)*g0.x+textureSampleLevel(reflectionRadiance,reflectionSampler,vec2f(high.x,low.y),level)*g1.x;
 let n=textureSampleLevel(reflectionRadiance,reflectionSampler,vec2f(low.x,high.y),level)*g0.x+textureSampleLevel(reflectionRadiance,reflectionSampler,high,level)*g1.x;
 return s*g0.y+n*g1.y;
}
fn reflectionRadianceAt(uv:vec2f,level:f32)->vec4f{
 let below=floor(level);
 let at=reflectionLevelRead(uv,below);
 if(level==below){return at;}
 return mix(at,reflectionLevelRead(uv,below+1.0),level-below);
}
fn reflectionFootprint(Q:vec2f,hit:vec3f,P:vec3f,R:vec3f,pixel:f32,alpha:f32,lobe:vec4f)->vec4f{
 let reach=2.0*distance(hit,P)/max(pixel,1e-30);
 let short=max(reach*reflectionConeTangent(alpha),1.0);
 let long=max(reach*reflectionConeTangent(lobe.w),short);
 let taps=min(ceil(long/short),REFLECTION_TAPS);
 let width=max(short,long/REFLECTION_TAPS);
 let level=min(log2(width),reflectionView.radiance.z);
 let across=lobe.xyz-R*dot(lobe.xyz,R);
 let toward=clipToFramebuffer(reflectionView.radianceViewProj*vec4f(hit+across*pixel,1.0),reflectionView.radiance.xy).xy-Q;
 let span=(long-width)*toward*inverseSqrt(max(dot(toward,toward),1e-30));
 let texel=1.0/vec2f(textureDimensions(reflectionRadiance));
 var sum=vec4f(0.0);
 for(var k=0.0;k<taps;k+=1.0){
  sum+=reflectionRadianceAt((Q+span*((k+0.5)/taps-0.5))*texel,level);
 }
 return sum/taps;
}
fn reflectionSeen(P:vec3f,N:vec3f,R:vec3f,alpha:f32,lobe:vec4f)->ReflectionSeen{
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
 let marched=reflectionMarch(S0,d,reflectionScreenEnd(S0.xy,d.xy,size));
 if(marched.t<0.0||marched.depth<=0.0){return seen;}
 let H=S0+d*marched.t;
 let hit=reflectionWorldAt(H.xy,marched.depth);
 let gap=distance(reflectionWorldAt(H.xy,H.z),hit);
 let fade=reflectionThicknessFade(gap,reflectionThickness(hit))*reflectionEdgeFade(H.xy,size);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(fade==0.0||previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy);
 seen.fade=fade*reflectionEdgeFade(Q.xy,reflectionView.radiance.xy);
 if(seen.fade==0.0){return seen;}
 let w=(reflectionView.viewProj*vec4f(hit,1.0)).w;
 seen.color=reflectionFootprint(Q.xy,hit,P,R,w*scale,alpha,lobe);
 return seen;
}
fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32,lobe:vec4f)->vec3f{
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 let R=reflect(-V,N);
 let environment=reflectionEnvironment(R,r);
 let trace=reflectionTraceWeight(r);
 if(trace==0.0||reflectionView.counts.x==0u||dot(N,V)<=0.0){return environment;}
 let seen=reflectionSeen(P,N,R,r*r,lobe);
 let screen=seen.color.rgb+(1.0-clamp(seen.color.a,0.0,1.0))*environment;
 return mix(environment,screen,seen.fade*trace);
}`,
  )

/**
 * What a lit surface keeps of the radiance it reflects: the engine's split-sum term of its GGX lobe
 * at its roughness and N·V (`reflectionWeight`, the fitted magnitude and Fresnel share the rectangle
 * lights read, `ltcLookup`, in every lighting program), on its reflectance; a clear coat adds its own dielectric lobe on its
 * normal and roughness, the environment's, and lets the base through as it lets every other term
 * (`lobeReflection`). A program without lobes passes the base as it is. `reflectionLobe` is the
 * long axis of the lobe the lights read (`setLobes`): its direction and αt where the material is
 * anisotropic, a round lobe of rough² elsewhere.
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
    ? `fn reflectionLobe(rough:f32)->vec4f{
 if(lobes.on&&lobes.strength>0.0){return vec4f(lobes.T,lobes.at);}
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 return vec4f(0.0,0.0,0.0,r*r);
}
fn lobeReflection(m:vec3f,V:vec3f)->vec3f{
 if(!lobes.on){return m;}
 var coat=vec3f(0.0);
 if(lobes.coat>0.0){
  let r=clamp(lobes.coatRough,ROUGHNESS_FLOOR,1.0);
  coat=lobes.coat*reflectionEnvironment(reflect(-V,lobes.coatN),r)*reflectionWeight(vec3f(0.0),0.0,r,lobes.coatN,V);
 }
 return m*lobes.through+coat;
}`
    : `fn reflectionLobe(rough:f32)->vec4f{let r=clamp(rough,ROUGHNESS_FLOOR,1.0);return vec4f(0.0,0.0,0.0,r*r);}
fn lobeReflection(m:vec3f,V:vec3f)->vec3f{return m;}`
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
 return lobeReflection(reflectedRadiance(P,N,V,rough,reflectionLobe(rough))*reflectionWeight(rgb,metal,rough,N,V),V);
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

/** The opaque resolve's binding of the reflection's view (`REFLECTION_VIEW_WGSL`), whose
 *  surroundings its coat reflects. */
export const REFLECTION_VIEW_BINDING = 34

/** The opaque resolve's reflection: the radiance the compute pass traced for its pixel, weighted
 *  as a forward program weighs its own (`reflectionWeightWgsl`). */
export const resolvedReflectionWgsl = (lobes: boolean) =>
  wgslBlock(
    `resolvedReflectionWgsl(${lobes})`,
    [REFLECTION_VIEW_WGSL, reflectionWeightWgsl(lobes)],
    `${REFLECTION_TARGET.wgsl}
@group(0) @binding(${REFLECTION_VIEW_BINDING}) var<uniform> reflectionView:ReflectionView;
fn resolvedReflection(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return lobeReflection(textureLoad(reflectionTarget,coord).rgb*reflectionWeight(rgb,metal,rough,N,V),V);
}`,
  )
