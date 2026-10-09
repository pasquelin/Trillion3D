import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'
import { f0Of, ndotvClamped, splitSumTerm } from '../../../math/src/wgsl/lighting.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { lobeRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { probeFieldWgsl } from '../bounce/gridWgsl.ts'
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
 * goes one level finer; one behind it stays and goes one level finer. At level 0, behind the pixel's
 * plane, it hits that surface if it was in front of the plane one pixel of its path earlier; else it
 * passes behind a surface it never crossed. It misses there, when it leaves the image or reaches its
 * far end (`reflectionReach`), and when its iterations — `REFLECTION_ITERATIONS_PER_LEVEL` a level
 * of the pyramid — run out, the plain miss of a ray that skims a surface.
 *
 * THE HIT is the pixel's surface where the ray crossed it, on its plane. Its confidence is the
 * smooth fades of the image's border (in this image and in the one the radiance is read from) and
 * of the footprint's pyramid level (`reflectionLevelTrust`): 1 up to the level below the pyramid's
 * top, 0 at it, where a texel spans the image. The march ends where the footprint reaches that level
 * (`reflectionReach`), so a rough lobe marches only as far as it still answers.
 *
 * THE HIT'S RADIANCE is the previous image, reprojected with the view-projection it was drawn with,
 * read from its filtered pyramid (`gpu.ts`) over the reflected lobe's footprint there
 * (`reflectionFootprint`): an ellipse whose axes are 2 · hit distance · tan of the GGX lobe's
 * half-maximum angle (`reflectionConeTangent`) at the lobe's two widths, its long axis along the
 * lobe's (`ReflectionLobe`); the pyramid level is the short axis's (or the long axis's share of the taps), read smooth between and within
 * levels (`reflectionRadianceAt`), and up to `REFLECTION_TAPS` taps cover the long axis. Each read
 * is weighted by its depth (`reflectionDepthWeight`, bilateral): the depth the pyramid holds under
 * it must lie on the hit's surface — the hit pixel's plane carried to it, the footprint's width on either side,
 * widened by the depth that plane spans between them —, so that a footprint across a silhouette
 * never mixes the surface in front with the one behind. The colour is the weighted reads over their
 * coverage (the image's alpha: 0 on the background); the share of the depth-weighted reads the image
 * covers multiplies the confidence.
 *
 * THE LOBE (`reflectionLobeOf`) is one ellipse of directions around `R` for both answers: its two
 * widths — α = rough² across, and the material's αt along its long axis `T` (`reflectionLobe`) —
 * set the screen footprint's two axes, and the same two widths filter the radiance field.
 *
 * THE REFLECTION is mix(field, hit radiance, confidence). The field (`reflectionField`) is the
 * radiance the diffuse lighting reads, in order-2 harmonics: the environment's coefficients
 * (`directLights.environment`), plus the bounce probes' where the cascades reach the point — what
 * the scene's lit surfaces send, a probe ray that leaves the scene adding nothing, so the
 * environment is the rest and alone where no probe answers —, plus, in a scene that declares no
 * light around it, the background the view shows (`surroundings`, `gpu.ts`): a miss reads what is
 * around the surface, never black. Each set of harmonics is read through the lobe exactly
 * (`lobeRadianceShader`): an order-2 radiance is a polynomial of degree two in the direction, whose
 * mean over the lobe takes its first two moments. Each axis keeps the moments of the round GGX lobe
 * of its width (`reflectionBands`: band attenuations a₁, a₂) — its share of the mean cosine's
 * deficit, (1 − a₁)/2, and its variance, σ² = (1 − a₂)/3 —, so with s the short axis and t the
 * long one: band 1 × (a₁s + a₁t)/2 at `R`, band 2 × (2a₂s + a₂t)/3 at `R` plus × (a₂s − a₂t)/3 at
 * `T`; a round lobe is the zonal convolution.
 *
 * Its weight is the engine's own split-sum term of the GGX lobe (`reflectionWeight`, the rectangle
 * lights' fitted magnitude and Fresnel share): the energy the lights' specular lobe leaves to the
 * environment, never a second model. Nothing of it reads a frame index, a seed or a history of its
 * own: two images of a still view give the same bits.
 */

/** Iterations a level of the depth pyramid pays the march: a ray crosses at most two cells of each
 *  level climbing and two descending, and each refused ascent is one more — eight a level, `levels
 *  × 8` in all. A ray that skims a surface the pyramid's bounds cannot clear (they hold the
 *  farthest height of a cell, not its tilt) needs more: it is a miss. */
export const REFLECTION_ITERATIONS_PER_LEVEL = 8
/** The image border, a fraction of its height, over which a hit fades into the environment. */
export const REFLECTION_EDGE = 1 / 16
/** The taps of a footprint along its long axis at most: past that ratio of its axes, the level is
 *  the long axis's share of a tap. */
export const REFLECTION_TAPS = 5

const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  `const REFLECTION_ITERATIONS_PER_LEVEL:u32=${REFLECTION_ITERATIONS_PER_LEVEL}u;
const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_TAPS:f32=${wgslF32(REFLECTION_TAPS)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=${wgslF32(2 ** -8)};
const REFLECTION_FAR:f32=${wgslF32(2 ** 23)};`,
)

/**
 * The cone and the fades, pure functions of their arguments.
 *
 * `reflectionConeTangent`: tan of the half-angle of the reflected GGX lobe of width `alpha`
 * (rough², or a stretched lobe's α along its direction), twice the half-vector's angle at half the
 * distribution's peak — D(θ)/D(0) = ½ gives tan²θ = α²(√2 − 1)/(1 − √2 α²) —, the half-vector's
 * angle bounded at 40°: the half-maximum angle of a lobe past α² = 1/√2 does not exist, and a
 * half-vector at 45° reflects 90° off the centre, a tangent without bound; 40° keeps it finite
 * (tan 80°), a footprint far wider than the radiance pyramid's coarsest level, which the level
 * trust (`reflectionLevelTrust`) already gives up. Zero on a mirror.
 * `reflectionEdgeFade`: 1 inside the image of `size`, falling smoothly to 0 at its edge over
 * `REFLECTION_EDGE` of its height. `reflectionLevelTrust`: the screen's share by the footprint's
 * pyramid level against the pyramid's top one: 1 up to the level below the top, falling smoothly
 * to 0 at the top, whose texel spans the whole image.
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
fn reflectionLevelTrust(level:f32,top:f32)->f32{return 1.0-smoothstep(top-1.0,top,level);}`,
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
 * The round GGX lobe of width `alpha`, its zonal moments for an order-2 radiance field: with z =
 * N·L, its normalized density is z/(1 + k + (k − 1)z)², k = α²; the zonal convolution multiplies
 * bands 1 and 2 by a₁ = E[z] and a₂ = E[(3z² − 1)/2] (band 0 whole) — a geometric series below
 * q = ¼ (its tail after twelve terms under 3e-7), the closed form above.
 */
const REFLECTION_BANDS_WGSL = wgslBlock(
  'REFLECTION_BANDS_WGSL',
  [],
  `fn reflectionBands(alpha:f32)->vec2f{
 let k=max(alpha*alpha,1e-8);
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
 return vec2f(moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}`,
)

/**
 * The reflected lobe (see the head of this file): its centre `R`, its long axis `T` — the
 * material's direction `lobe.xyz` across `R`, unit, zero on a round lobe —, the band factors its
 * two widths give an order-2 radiance (`bands`: band 1 at `R`, band 2 at `R`, band 2 at `T`) and
 * those widths (`widths`: α across, αt along `T`).
 */
const REFLECTION_LOBE_WGSL = wgslBlock(
  'REFLECTION_LOBE_WGSL',
  [REFLECTION_BANDS_WGSL],
  `struct ReflectionLobe{R:vec3f,T:vec3f,bands:vec3f,widths:vec2f,}
fn reflectionLobeOf(R:vec3f,alpha:f32,lobe:vec4f)->ReflectionLobe{
 let s=reflectionBands(alpha);
 var t=s;
 if(lobe.w!=alpha){t=reflectionBands(lobe.w);}
 let across=lobe.xyz-R*dot(lobe.xyz,R);
 let T=across*inverseSqrt(max(dot(across,across),1e-30));
 return ReflectionLobe(R,T,vec3f(0.5*(s.x+t.x),(2.0*s.y+t.y)/3.0,(s.y-t.y)/3.0),vec2f(alpha,lobe.w));
}`,
)

/** The radiance around the scene through a lobe (`reflectionEnvironment`): the environment's
 *  order-2 coefficients the diffuse term reads through the cosine lobe (`directLights.environment`),
 *  and the uniform radiance the view's `surroundings` add, which every lobe keeps whole. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_LOBE_WGSL, REFLECTION_VIEW_WGSL],
  `fn reflectionEnvironment(lobe:ReflectionLobe)->vec3f{
 return max(vec3f(0.0),${lobeRadianceShader((k) => `directLights.environment[${k}].rgb`, 'lobe')})+reflectionView.surroundings.rgb;
}`,
)

/** The bounce probes' radiance through a lobe, at a point of normal `N` (`reflectionProbes`): the
 *  cascades' field (`probeFieldWgsl`), each probe's coefficients read through the lobe, never
 *  negative. */
const REFLECTION_PROBES_WGSL = wgslBlock(
  'REFLECTION_PROBES_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    probeFieldWgsl(
      'reflectionProbes',
      'reflectionProbeLevel',
      ',lobe:ReflectionLobe',
      `max(vec3f(0.0),${lobeRadianceShader((k) => `probeAt(probe,${k}u).xyz`, 'lobe')})`,
    ),
  ],
  '',
)

/**
 * The radiance field a surface at `P`, of normal `N`, reflects through `lobe` (`reflectionField`,
 * see the head of this file): the environment and the bounce probes. `probes` names a program that
 * binds the cascades (`bounce`, `probes`); one that does not is the program of a session without
 * bounce, where the probes' share is zero, and reads the environment alone.
 */
const reflectionFieldWgsl = (probes: boolean) =>
  wgslBlock(
    `reflectionFieldWgsl(${probes})`,
    [REFLECTION_ENVIRONMENT_WGSL, ...(probes ? [REFLECTION_PROBES_WGSL] : [])],
    `fn reflectionField(P:vec3f,N:vec3f,lobe:ReflectionLobe)->vec3f{
 return reflectionEnvironment(lobe)${probes ? '+reflectionProbes(P,N,lobe)' : ''};
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
 * from a point to the eye (`reflectionToEye`) and a slab (`reflectionSlab`): the reversed depths of
 * the point `thickness` behind a point and `thickness` in front of it along the eye's ray.
 */
const REFLECTION_GEOMETRY_WGSL = wgslBlock(
  'REFLECTION_GEOMETRY_WGSL',
  [pixelToNdc, unprojectPoint],
  `fn reflectionWorldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(reflectionView.inverseViewProj,vec3f(pixelToNdc(pixel,reflectionView.screen.xy),z));
}
fn reflectionToEye(P:vec3f)->vec3f{return normalize(reflectionView.camera.xyz-P*reflectionView.camera.w);}
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
 * cell's nearest depth above it. It returns the `t` it stopped at, and the plane (depth at its
 * centre, slopes) and centre of the pixel it stopped in (`ReflectionHit`); `t` −1 on a miss.
 *
 * A ray in front of a cell's surface moves to the surface where it meets it, else to the cell's
 * boundary and one level coarser; one behind a cell's nearest depth stays and goes one level finer.
 * At level 0 the ray is behind the pixel's plane, and stops there if it was in front of it one step
 * — one pixel of its path — earlier, after the last place it was in front of everything it passed:
 * it crossed that plane, and hits the surface. Behind it without a crossing, the ray passes behind
 * a surface it never met: a miss. `last` begins at the first pixel boundary, so a hit is never in
 * the pixel the ray leaves.
 */
export const REFLECTION_MARCH_WGSL = wgslBlock(
  'REFLECTION_MARCH_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `struct ReflectionHit{t:f32,plane:vec3f,pixel:vec2f,}
fn reflectionScreenEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(1.0),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn reflectionMarch(o:vec3f,d:vec3f,end:f32)->ReflectionHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-REFLECTION_NUDGE),vec2f(REFLECTION_NUDGE),ahead);
 let step=1.0/max(max(abs(d.x),abs(d.y)),1e-6);
 let levels=hizLevelCount();
 let top=levels-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 var t=min(first.x,first.y);
 var last=t;
 var level=0;
 for(var k=0u;k<REFLECTION_ITERATIONS_PER_LEVEL*u32(levels);k++){
  if(t>end){break;}
  let p=o+d*t;
  let size=exp2(f32(level));
  let cell=floor(p.xy/size);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(exits.x,exits.y);
  var plane=vec3f(0.0);
  var height=0.0;
  var rate=d.z;
  if(level==0){
   plane=hizPlane(vec2i(cell));
   height=p.z-plane.x-dot(p.xy-cell-vec2f(0.5),plane.yz);
   rate=d.z-dot(d.xy,plane.yz);
  }else{height=p.z-hizCell(vec2i(cell),level).y;}
  if(height>=0.0){
   last=t;
   let reach=t-height/min(rate,-1e-30);
   if(rate>=0.0||across<reach){t=across;level=min(level+1,top);continue;}
   t=reach;
  }else if(level==0){
   let crossed=t-height/min(rate,-1e-30);
   if(rate>=0.0||crossed<max(last,t-step)){break;}
   t=crossed;
  }
  if(level==0){
   if(t>end){break;}
   return ReflectionHit(t,plane,cell+vec2f(0.5));
  }
  level-=1;
 }
 return ReflectionHit(-1.0,vec3f(0.0),vec2f(0.0));
}`,
)

/**
 * The footprint a hit reads (see the head of this file), its resources in bind group `group`. Its
 * reads sum as `ReflectionTaps`: the depth-weighted colour and coverage, and the depth weights.
 * `toView` maps a point of the radiance image to this image's pixels (`xy` + uv · `zw`), the hit's
 * at the centre of the pixel the ray stopped in, where the depth is read; `ReflectionSurface` is
 * that pixel, its plane and half the hit's slab (`reflectionSlab`).
 * `reflectionConeAt`: the cone of `lobe` at `distance` from its surface, a pixel `pixel` wide there —
 * its axes' diameters in pixels, at least one, and the pyramid level of the width a read spans, the
 * short axis's or the long axis's share of `REFLECTION_TAPS` taps.
 * `reflectionDepthWeight`: 1 where the depth at `X` lies within the surface's thickness of its plane
 * carried to `X`, widened by the depth the plane spans from its pixel to `X`, falling smoothly to 0
 * two thicknesses farther. `reflectionLevelRead` reads one level at `uv`, weighted by the depth
 * there: level 0, the image itself, as the sampler interpolates it, sharp; a coarser one as a cubic
 * B-spline of its texels (four bilinear reads under one weight), smooth, so that a blurred
 * reflection is a round blob at every level, never a texel's square. `reflectionRadianceAt` reads a
 * fractional level between its two.
 */
export const reflectionFootprintWgsl = (group: number) =>
  wgslBlock(
    `reflectionFootprintWgsl(${group})`,
    [reflectionBindingsWgsl(group), REFLECTION_CONE_WGSL, REFLECTION_LOBE_WGSL, clipToFramebuffer],
    `struct ReflectionTaps{color:vec4f,weight:f32,}
struct ReflectionSurface{pixel:vec2f,plane:vec3f,thickness:f32,}
struct ReflectionCone{short:f32,long:f32,level:f32,}
fn reflectionConeAt(distance:f32,pixel:f32,lobe:ReflectionLobe)->ReflectionCone{
 let reach=2.0*distance/max(pixel,1e-30);
 let short=max(reach*reflectionConeTangent(lobe.widths.x),1.0);
 let long=max(reach*reflectionConeTangent(lobe.widths.y),short);
 return ReflectionCone(short,long,log2(max(short,long/REFLECTION_TAPS)));
}
fn reflectionDepthWeight(X:vec2f,surface:ReflectionSurface)->f32{
 let size=vec2i(reflectionView.screen.xy);
 let z=textureLoad(hizDepth,clamp(vec2i(floor(X)),vec2i(0),size-vec2i(1)),0).r;
 let along=dot(X-surface.pixel,surface.plane.yz);
 let apart=max(abs(z-surface.plane.x-along)-surface.thickness-abs(along),0.0);
 return 1.0-smoothstep(0.0,2.0*surface.thickness,apart);
}
fn reflectionLevelColor(uv:vec2f,level:f32)->vec4f{
 if(level==0.0){return textureSampleLevel(reflectionRadiance,reflectionSampler,uv,0.0);}
 let size=vec2f(textureDimensions(reflectionRadiance,u32(level)));
 let t=uv*size-vec2f(0.5);let i=floor(t);let f=t-i;
 let f2=f*f;let f3=f2*f;let e=vec2f(1.0)-f;
 let w0=e*e*e/6.0;let w1=(vec2f(4.0)-6.0*f2+3.0*f3)/6.0;let w3=f3/6.0;let w2=vec2f(1.0)-w0-w1-w3;
 let g0=w0+w1;let g1=w2+w3;
 let low=(i-vec2f(0.5)+w1/g0)/size;let high=(i+vec2f(1.5)+w3/g1)/size;
 return g0.x*g0.y*textureSampleLevel(reflectionRadiance,reflectionSampler,low,level)
  +g1.x*g0.y*textureSampleLevel(reflectionRadiance,reflectionSampler,vec2f(high.x,low.y),level)
  +g0.x*g1.y*textureSampleLevel(reflectionRadiance,reflectionSampler,vec2f(low.x,high.y),level)
  +g1.x*g1.y*textureSampleLevel(reflectionRadiance,reflectionSampler,high,level);
}
fn reflectionLevelRead(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let w=share*reflectionDepthWeight(toView.xy+uv*toView.zw,surface);
 if(w>0.0){
  (*sum).color+=w*reflectionLevelColor(uv,level);
  (*sum).weight+=w;
 }
}
fn reflectionRadianceAt(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let below=floor(level);
 let f=level-below;
 reflectionLevelRead(sum,uv,below,share*(1.0-f),toView,surface);
 if(f>0.0){reflectionLevelRead(sum,uv,below+1.0,share*f,toView,surface);}
}
fn reflectionFootprint(Q:vec2f,hit:vec3f,pixel:f32,lobe:ReflectionLobe,cone:ReflectionCone,toView:vec4f,surface:ReflectionSurface)->ReflectionTaps{
 let taps=min(ceil(cone.long/cone.short),REFLECTION_TAPS);
 let level=min(cone.level,reflectionView.radiance.z);
 let texel=1.0/vec2f(textureDimensions(reflectionRadiance));
 var sum=ReflectionTaps(vec4f(0.0),0.0);
 if(taps<2.0){
  reflectionRadianceAt(&sum,Q*texel,level,1.0,toView,surface);
  return sum;
 }
 let toward=clipToFramebuffer(reflectionView.radianceViewProj*vec4f(hit+lobe.T*pixel,1.0),reflectionView.radiance.xy).xy-Q;
 let span=(cone.long-exp2(cone.level))*toward*inverseSqrt(max(dot(toward,toward),1e-30));
 for(var k=0.0;k<taps;k+=1.0){
  reflectionRadianceAt(&sum,(Q+span*((k+0.5)/taps-0.5))*texel,level,1.0,toView,surface);
 }
 return sum;
}`,
  )

/** `reflectionReach`: the world distance along a reflected ray, from its origin `A` (clip) along
 *  `toward` (clip), to which the screen can answer: where it meets the near plane, or where the
 *  lobe's footprint grows to the radiance pyramid's top level — the widest short axis, or the long
 *  axis's share of the taps, 2 · s · tan = 2^top pixels, a pixel `scale · w` wide at the clip `w`
 *  of the point, which grows along the ray at `toward.w` —, past which `reflectionLevelTrust` is
 *  zero. A mirror's reach is the near plane's, or `REFLECTION_FAR`.
 *  `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, the hit, its footprint and its confidence (see the head of
 *  this file). */
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
fn reflectionReach(A:vec4f,toward:vec4f,lobe:ReflectionLobe)->f32{
 let grow=toward.z-toward.w;
 let near=select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let top=exp2(reflectionView.radiance.z)*reflectionView.screen.z;
 let room=2.0*tangent-top*toward.w;
 return min(near,select(REFLECTION_FAR,top*A.w/room,room>0.0));
}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionSeen{
 var seen=ReflectionSeen(vec3f(0.0),0.0);
 let size=reflectionView.screen.xy;
 let scale=reflectionView.screen.z;
 // One pixel off the surface along its normal: a ray never starts inside the depth it leaves.
 let origin=P+N*((reflectionView.viewProj*vec4f(P,1.0)).w*scale);
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(lobe.R,0.0);
 let S0=clipToFramebuffer(A,size);
 let d=clipToFramebuffer(A+toward*reflectionReach(A,toward,lobe),size)-S0;
 let marched=reflectionMarch(S0,d,reflectionScreenEnd(S0.xy,d.xy,size));
 if(marched.t<0.0||marched.plane.x<=0.0){return seen;}
 let H=S0+d*marched.t;
 let hit=reflectionWorldAt(H.xy,marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz));
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let edge=reflectionEdgeFade(H.xy,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let pixel=(reflectionView.viewProj*vec4f(hit,1.0)).w*scale;
 let cone=reflectionConeAt(distance(hit,P),pixel,lobe);
 let confidence=edge*reflectionLevelTrust(cone.level,reflectionView.radiance.z);
 if(confidence==0.0){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionRadiance))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let slab=reflectionSlab(hit,pixel*cone.long);
 let surface=ReflectionSurface(marched.pixel,marched.plane,0.5*(slab.y-slab.x));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=confidence*min(taps.color.a/taps.weight,1.0);
 return seen;
}`,
  )

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects — the one function of every program (see the head of this file), each of
 * which binds the bounce cascades. `lobe` is the lobe's long axis: its direction (`xyz`, any on a
 * round lobe) and its α along it (`w`; rough² on a round lobe), the material's anisotropic GGX
 * parameters (`reflectionLobe`).
 */
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [reflectionSeenWgsl(group), reflectionFieldWgsl(true), ROUGHNESS_FLOOR],
    `fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32,lobe:vec4f)->vec3f{
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 let ellipse=reflectionLobeOf(reflect(-V,N),r*r,lobe);
 let field=reflectionField(P,N,ellipse);
 if(reflectionView.counts.x==0u||dot(N,V)<=0.0){return field;}
 let seen=reflectionSeen(P,N,ellipse);
 return mix(field,seen.color,seen.confidence);
}`,
  )

/**
 * What a lit surface keeps of the radiance it reflects: the engine's split-sum term of its GGX lobe
 * at its roughness and N·V (`reflectionWeight`, the fitted magnitude and Fresnel share the rectangle
 * lights read, `ltcLookup`, in every lighting program), on its reflectance; a clear coat adds its own dielectric lobe on its
 * normal and roughness, the environment's, and lets the base through as it lets every other term
 * (`lobeReflection`), its field the base's (`reflectionField`, read at `P`; with the cascades where
 * `probes`). A program without lobes passes the base as it is. `reflectionLobe` is the long axis of
 * the lobe the lights read (`setLobes`): its direction and αt where the material is anisotropic, a
 * round lobe of rough² elsewhere.
 */
export const reflectionWeightWgsl = (lobes: boolean, probes: boolean) =>
  wgslBlock(
    `reflectionWeightWgsl(${lobes}, ${probes})`,
    [reflectionFieldWgsl(probes), splitSumTerm, f0Of, ndotvClamped, ROUGHNESS_FLOOR],
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
fn lobeReflection(m:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!lobes.on){return m;}
 var coat=vec3f(0.0);
 if(lobes.coat>0.0){
  let r=clamp(lobes.coatRough,ROUGHNESS_FLOOR,1.0);
  let a=r*r;
  let field=reflectionField(P,lobes.coatN,reflectionLobeOf(reflect(-V,lobes.coatN),a,vec4f(0.0,0.0,0.0,a)));
  coat=lobes.coat*field*reflectionWeight(vec3f(0.0),0.0,r,lobes.coatN,V);
 }
 return m*lobes.through+coat;
}`
    : `fn reflectionLobe(rough:f32)->vec4f{let r=clamp(rough,ROUGHNESS_FLOOR,1.0);return vec4f(0.0,0.0,0.0,r*r);}
fn lobeReflection(m:vec3f,V:vec3f,P:vec3f)->vec3f{return m;}`
}`,
  )

/** A forward program's reflection (blend, water), inline in its fragment stage, its resources in
 *  bind group `group`. */
export const forwardReflectionWgsl = (group: number, lobes: boolean) =>
  wgslBlock(
    `forwardReflectionWgsl(${group}, ${lobes})`,
    [reflectedRadianceWgsl(group), reflectionWeightWgsl(lobes, true)],
    `fn surfaceReflection(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return lobeReflection(reflectedRadiance(P,N,V,rough,reflectionLobe(rough))*reflectionWeight(rgb,metal,rough,N,V),V,P);
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
 *  surroundings its coat's field holds. */
export const REFLECTION_VIEW_BINDING = 34

/** The opaque resolve's reflection: the radiance the compute pass traced for its pixel, weighted
 *  as a forward program weighs its own (`reflectionWeightWgsl`); `probes`, the program binds the
 *  bounce cascades. */
export const resolvedReflectionWgsl = (lobes: boolean, probes: boolean) =>
  wgslBlock(
    `resolvedReflectionWgsl(${lobes}, ${probes})`,
    [REFLECTION_VIEW_WGSL, reflectionWeightWgsl(lobes, probes)],
    `${REFLECTION_TARGET.wgsl}
@group(0) @binding(${REFLECTION_VIEW_BINDING}) var<uniform> reflectionView:ReflectionView;
fn resolvedReflection(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!reflects()){return vec3f(0.0);}
 return lobeReflection(textureLoad(reflectionTarget,coord).rgb*reflectionWeight(rgb,metal,rough,N,V),V,P);
}`,
  )
