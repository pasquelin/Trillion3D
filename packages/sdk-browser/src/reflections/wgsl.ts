import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'
import { f0Of, ndotvClamped, splitSumTerm } from '../../../math/src/wgsl/lighting.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { filteredRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstantsWgsl.ts'
import { MODEL_FLAG } from '../scene/surfaceModel.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { hizDepthWgsl } from '../gpu/hiz/pyramidTexture.ts'

/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE.
 *
 * What a surface reflects along its mirror direction `R` is one function (`reflectedRadiance`)
 * every program shares — the opaque surfaces in one compute pass (`gpu.ts`), the blended surfaces
 * and the water inline in their fragment stage. It reads three things of the view: its depth, the
 * previous lit image of the same view, and the radiance around the scene.
 *
 * THE MARCH (`reflectionMarch`) is the hierarchical ray march of a depth pyramid: the ray in screen
 * space, pixels and reversed depth, leaves the surface one pixel off it along its normal, and first
 * advances to its own pixel's boundary. Each iteration intersects the ray with its cell at the
 * current level: the cell's two boundary lines it moves toward, and its nearest surface — at level
 * 0 the pixel's own plane (its depth and the slopes the pyramid keeps, `hizPlane`), above it the
 * cell's nearest depth (`hizCell`). A ray in front of that surface that reaches the cell's boundary
 * first moves there and goes one level coarser; one that reaches the surface first moves onto it and
 * goes one level finer; one behind it stays and goes one level finer. It stops when it would go
 * finer than level 0 — in contact with a pixel's plane, or behind it, where it crossed that plane if
 * it did within the last pixel it travelled —; it misses when it leaves the image or reaches its far
 * end, or after `REFLECTION_ITERATIONS` iterations.
 *
 * THE HIT is the pixel's surface where the ray stopped, accepted by a fixed thickness: the distance
 * between the ray's point and that surface — the depth the pixel holds, on its plane — is set
 * against `REFLECTION_THICKNESS` of the view's height at the hit's distance, (1 − smoothstep(0,
 * thickness, gap))², 1 in contact, 0 a thickness away or more. A hit within two pixels of the ray's
 * start is the surface it leaves: none. The confidence multiplies the acceptance by smooth fades:
 * the image's border (in this image and in the one the radiance is read from), the march's length
 * (its last quarter of iterations, to none at the bound) and the roughness past which the screen
 * gives way to the environment (`reflectionTraceWeight`).
 *
 * THE HIT'S RADIANCE is the previous image, reprojected with the view-projection it was drawn with,
 * read from its filtered pyramid (`gpu.ts`) over the reflected lobe's footprint there
 * (`reflectionFootprint`): an ellipse whose axes are 2 · hit distance · tan of the GGX lobe's
 * half-maximum angle (`reflectionConeTangent`) at the lobe's two widths, its long axis along the
 * lobe's stretched direction; the pyramid level is the short axis's, read smooth between and within
 * levels (`reflectionRadianceAt`), and up to `REFLECTION_TAPS` taps cover the long axis. Each read
 * is weighted by its depth (`reflectionDepthWeight`, bilateral): the depth the pyramid holds under
 * it must lie on the hit's surface — the hit pixel's plane carried to it, a thickness on either side,
 * widened by the depth that plane spans between them —, so that a footprint across a silhouette
 * never mixes the surface in front with the one behind. The colour is the weighted reads over their
 * coverage (the image's alpha: 0 on the background); the share of the depth-weighted reads the image
 * covers multiplies the confidence.
 *
 * THE REFLECTION is mix(environment, hit radiance, confidence). The environment
 * (`reflectionEnvironment`) is what the diffuse lighting reads — its order-2 coefficients through the
 * GGX lobe of the roughness —, plus, in a scene that declares no light around it, the background the
 * view shows (`surroundings`, `gpu.ts`): a miss reads what is around the scene, never black.
 *
 * Its weight is the engine's own split-sum term of the GGX lobe (`reflectionWeight`, the rectangle
 * lights' fitted magnitude and Fresnel share): the energy the lights' specular lobe leaves to the
 * environment, never a second model. Nothing of it reads a frame index, a seed or a history of its
 * own: two images of a still view give the same bits.
 */

/** Iterations of the hierarchical march, the bound of a ray's cost: a ray in the open climbs and
 *  descends the pyramid's dozen levels in some thirty; one approaching a surface at a grazing angle
 *  walks it pixel by pixel, two iterations each, and a glass pane's ray over the floor at 2 Mpx takes
 *  up to eighty. */
export const REFLECTION_ITERATIONS = 128
/** Roughness from which the screen trace fades into the environment, and past which only the
 *  environment answers (the compute pass then marches nothing). */
export const REFLECTION_FADE_ROUGHNESS = 0.5
export const REFLECTION_TRACE_ROUGHNESS = 0.7
/** The image border, a fraction of its height, over which a hit fades into the environment. */
export const REFLECTION_EDGE = 1 / 16
/** The thickness a hit is accepted within: a fraction of the view's height at its distance (its
 *  world height under perspective, the view's under an orthographic camera). */
export const REFLECTION_THICKNESS = 1 / 32
/** The taps of a footprint along its long axis at most: past that ratio of its axes, the level is
 *  the long axis's share of a tap. */
export const REFLECTION_TAPS = 5

const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  `const REFLECTION_ITERATIONS:u32=${REFLECTION_ITERATIONS}u;
const REFLECTION_FADE_ROUGHNESS:f32=${wgslF32(REFLECTION_FADE_ROUGHNESS)};
const REFLECTION_TRACE_ROUGHNESS:f32=${wgslF32(REFLECTION_TRACE_ROUGHNESS)};
const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_THICKNESS:f32=${wgslF32(REFLECTION_THICKNESS)};
const REFLECTION_TAPS:f32=${wgslF32(REFLECTION_TAPS)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=0.005;
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
 * `REFLECTION_EDGE` of its height. `reflectionThicknessFade`: the hit's acceptance, (1 −
 * smoothstep(0, thickness, gap))². `reflectionLengthFade`: 1 to three quarters of the march's
 * iterations, smoothly 0 at their bound. `reflectionTraceWeight`: the screen's share by roughness, 1
 * to `REFLECTION_FADE_ROUGHNESS`, 0 from `REFLECTION_TRACE_ROUGHNESS`.
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
 let accepted=1.0-smoothstep(0.0,thickness,gap);
 return accepted*accepted;
}
fn reflectionLengthFade(iterations:f32)->f32{
 let bound=f32(REFLECTION_ITERATIONS);
 return 1.0-smoothstep(0.75*bound,bound,iterations);
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

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`). */
export const REFLECTION_DEPTH_BINDING = 3

/** The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the
 *  radiance pyramid and its trilinear sampler, then the depth it marches, the engine's pyramid
 *  (`hizDepthWgsl`). */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [REFLECTION_VIEW_WGSL, hizDepthWgsl(group, REFLECTION_DEPTH_BINDING)],
    `@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(1) var reflectionRadiance:texture_2d<f32>;
@group(${group}) @binding(2) var reflectionSampler:sampler;`,
  )

/**
 * The view's geometry: the world point of a pixel at a depth (`reflectionWorldAt`), the direction
 * from a point to the eye (`reflectionToEye`), the thickness a hit at a world point is accepted
 * within (`reflectionThickness`: `REFLECTION_THICKNESS` of the view's height at its clip `w`) and
 * its slab (`reflectionSlab`): the reversed depths of the point a thickness behind it and a
 * thickness in front of it along the eye's ray.
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
fn reflectionSlab(P:vec3f,thickness:f32)->vec2f{
 let toward=reflectionToEye(P)*thickness;
 let back=reflectionView.viewProj*vec4f(P-toward,1.0);
 let front=reflectionView.viewProj*vec4f(P+toward,1.0);
 return vec2f(back.z/back.w,front.z/max(front.w,1e-30));
}`,
)

/**
 * The march (see the head of this file) of `o + d·t`, `o` in pixels and reversed depth, `t` from 0
 * to `end` (`reflectionScreenEnd`: the image's edge, or the ray's far end). A cell's surface is the
 * pixel's plane at level 0 — the ray's height above it falls at d.z − slopes · d.xy along `t` —, the
 * cell's nearest depth above it. It returns the `t` it stopped at, the plane (depth at its centre,
 * slopes) and centre of the pixel it stopped in, and the iterations it took (`ReflectionHit`); `t`
 * −1 on a miss.
 */
export const REFLECTION_MARCH_WGSL = wgslBlock(
  'REFLECTION_MARCH_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `struct ReflectionHit{t:f32,plane:vec3f,pixel:vec2f,iterations:f32,}
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
 let top=hizLevelCount()-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 var t=min(first.x,first.y);
 var last=0.0;
 var level=0;
 var n=0u;
 var found=false;
 var plane=vec3f(0.0);
 var centre=vec2f(0.0);
 for(var k=0u;k<REFLECTION_ITERATIONS;k++){
  if(t>end){return ReflectionHit(-1.0,vec3f(0.0),vec2f(0.0),f32(n));}
  n=k+1u;
  let p=o+d*t;
  let size=exp2(f32(level));
  let cell=floor(p.xy/size);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(exits.x,exits.y);
  var height=0.0;
  var rate=d.z;
  if(level==0){
   plane=hizPlane(vec2i(cell));
   centre=cell+vec2f(0.5);
   height=p.z-plane.x-dot(p.xy-centre,plane.yz);
   rate=d.z-dot(d.xy,plane.yz);
  }else{height=p.z-hizCell(vec2i(cell),level).y;}
  if(height>=0.0){
   last=t;
   let reach=select(REFLECTION_FAR,t-height/min(rate,-1e-30),rate<0.0);
   if(across<reach){t=across;level=min(level+1,top);continue;}
   t=reach;
  }else if(level==0&&rate<0.0){
   // Behind the pixel's plane on entering it: where the ray crossed that plane, if it did within
   // the pixel it last crossed in front of the depth.
   let crossed=t-height/rate;
   if(crossed>=max(last,t-1.0/max(abs(d.x),abs(d.y)))){t=crossed;}
  }
  if(level==0){found=true;break;}
  level-=1;
 }
 if(!found||t>end){return ReflectionHit(-1.0,vec3f(0.0),vec2f(0.0),f32(n));}
 return ReflectionHit(t,plane,centre,f32(n));
}`,
)

/**
 * The footprint a hit reads (see the head of this file), its resources in bind group `group`. Its
 * reads sum as `ReflectionTaps`: the depth-weighted colour and coverage, and the depth weights
 * (`reflectionTap`). `toView` maps a point of the radiance image to this image's pixels (`xy` + uv ·
 * `zw`), the hit's at the centre of the pixel the ray stopped in, where the depth is read;
 * `ReflectionSurface` is that pixel, its plane and half the hit's slab (`reflectionSlab`).
 * `reflectionDepthWeight`: 1 where the depth at `X` lies within the surface's thickness of its plane
 * carried to `X`, widened by the depth the plane spans from its pixel to `X`, falling smoothly to 0
 * two thicknesses farther. `reflectionLevelRead` reads one level: level 0, the image itself, as the
 * sampler interpolates it, sharp; a coarser one as a cubic B-spline of its texels (four bilinear
 * reads, each weighted by its depth), smooth, so that a blurred reflection is a round blob at every
 * level, never a texel's square. `reflectionRadianceAt` reads a fractional level between its two.
 */
export const reflectionFootprintWgsl = (group: number) =>
  wgslBlock(
    `reflectionFootprintWgsl(${group})`,
    [reflectionBindingsWgsl(group), REFLECTION_CONE_WGSL, clipToFramebuffer],
    `struct ReflectionTaps{color:vec4f,weight:f32,}
struct ReflectionSurface{pixel:vec2f,plane:vec3f,thickness:f32,}
fn reflectionDepthWeight(X:vec2f,surface:ReflectionSurface)->f32{
 let size=vec2i(reflectionView.screen.xy);
 let z=textureLoad(hizDepth,clamp(vec2i(floor(X)),vec2i(0),size-vec2i(1)),0).r;
 let along=dot(X-surface.pixel,surface.plane.yz);
 let apart=max(abs(z-surface.plane.x-along)-surface.thickness-abs(along),0.0);
 return 1.0-smoothstep(0.0,2.0*surface.thickness,apart);
}
fn reflectionTap(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let w=share*reflectionDepthWeight(toView.xy+uv*toView.zw,surface);
 if(w>0.0){
  let c=textureSampleLevel(reflectionRadiance,reflectionSampler,uv,level);
  (*sum).color+=w*c;
  (*sum).weight+=w;
 }
}
fn reflectionLevelRead(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 if(level==0.0){reflectionTap(sum,uv,0.0,share,toView,surface);return;}
 let size=vec2f(textureDimensions(reflectionRadiance,u32(level)));
 let t=uv*size-vec2f(0.5);let i=floor(t);let f=t-i;
 let f2=f*f;let f3=f2*f;let e=vec2f(1.0)-f;
 let w0=e*e*e/6.0;let w1=(vec2f(4.0)-6.0*f2+3.0*f3)/6.0;let w3=f3/6.0;let w2=vec2f(1.0)-w0-w1-w3;
 let g0=w0+w1;let g1=w2+w3;
 let low=(i-vec2f(0.5)+w1/g0)/size;let high=(i+vec2f(1.5)+w3/g1)/size;
 reflectionTap(sum,low,level,share*g0.x*g0.y,toView,surface);
 reflectionTap(sum,vec2f(high.x,low.y),level,share*g1.x*g0.y,toView,surface);
 reflectionTap(sum,vec2f(low.x,high.y),level,share*g0.x*g1.y,toView,surface);
 reflectionTap(sum,high,level,share*g1.x*g1.y,toView,surface);
}
fn reflectionRadianceAt(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let below=floor(level);
 let f=level-below;
 reflectionLevelRead(sum,uv,below,share*(1.0-f),toView,surface);
 if(f>0.0){reflectionLevelRead(sum,uv,below+1.0,share*f,toView,surface);}
}
fn reflectionFootprint(Q:vec2f,hit:vec3f,P:vec3f,R:vec3f,pixel:f32,alpha:f32,lobe:vec4f,toView:vec4f,surface:ReflectionSurface)->ReflectionTaps{
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
 var sum=ReflectionTaps(vec4f(0.0),0.0);
 for(var k=0.0;k<taps;k+=1.0){
  reflectionRadianceAt(&sum,(Q+span*((k+0.5)/taps-0.5))*texel,level,1.0,toView,surface);
 }
 return sum;
}`,
  )

/** `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting along `R`
 *  through a lobe of width `alpha` and long axis `lobe` — the march, the hit, its footprint and its
 *  confidence (see the head of this file). */
const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      reflectionFootprintWgsl(group),
      REFLECTION_GEOMETRY_WGSL,
      REFLECTION_MARCH_WGSL,
      clipToFramebuffer,
    ],
    `struct ReflectionSeen{color:vec3f,confidence:f32,}
fn reflectionSeen(P:vec3f,N:vec3f,R:vec3f,alpha:f32,lobe:vec4f)->ReflectionSeen{
 var seen=ReflectionSeen(vec3f(0.0),0.0);
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
 if(marched.t<0.0||marched.plane.x<=0.0){return seen;}
 let H=S0+d*marched.t;
 let depth=marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz);
 // A hit within two pixels of the ray's start is the surface it leaves, never what it reflects.
 if(all(abs(H.xy-S0.xy)<vec2f(2.0))){return seen;}
 let hit=reflectionWorldAt(H.xy,depth);
 let thickness=reflectionThickness(hit);
 let gap=distance(reflectionWorldAt(H.xy,H.z),hit);
 var confidence=reflectionThicknessFade(gap,thickness)*reflectionEdgeFade(H.xy,size)*reflectionLengthFade(marched.iterations);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(confidence==0.0||previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 confidence*=reflectionEdgeFade(Q,reflectionView.radiance.xy);
 if(confidence==0.0){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionRadiance))*ratio);
 let w=(reflectionView.viewProj*vec4f(hit,1.0)).w;
 // The hit's surface: its plane across the image, a thickness deep on either side.
 let slab=reflectionSlab(hit,thickness);
 let surface=ReflectionSurface(marched.pixel,marched.plane,0.5*(slab.y-slab.x));
 let taps=reflectionFootprint(Q,hit,P,R,w*scale,alpha,lobe,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=confidence*min(taps.color.a/taps.weight,1.0);
 return seen;
}`,
  )

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects — the one function of every program (see the head of this file). `lobe` is the
 * lobe's long axis: its direction (`xyz`, any on a round lobe) and its α along it (`w`; rough² on a
 * round lobe), the material's anisotropic GGX parameters (`reflectionLobe`).
 */
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [reflectionSeenWgsl(group), REFLECTION_ENVIRONMENT_WGSL, ROUGHNESS_FLOOR],
    `fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32,lobe:vec4f)->vec3f{
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 let R=reflect(-V,N);
 let environment=reflectionEnvironment(R,r);
 let trace=reflectionTraceWeight(r);
 if(trace==0.0||reflectionView.counts.x==0u||dot(N,V)<=0.0){return environment;}
 let seen=reflectionSeen(P,N,R,r*r,lobe);
 return mix(environment,seen.color,seen.confidence*trace);
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
