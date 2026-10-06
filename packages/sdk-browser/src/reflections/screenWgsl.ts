import { REFLECTION_CONE_WGSL } from './coneWgsl.ts'
import { interleavedGradientWgsl } from '../math/interleavedGradientWgsl.ts'
import { REFLECTION_SEGMENT, screenTraceShader } from './traceShader.ts'
import {
  type ScreenLobe,
  type ScreenRadiance,
  screenRadianceShader,
} from './screenRadianceShader.ts'
import { HIZ_TRACE_WGSL } from './hizTraceWgsl.ts'
import { TRANSLUCENT_SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts'

/** The WebGPU resolve: its fallback is the program's own reflection model, the probes with bounce
 *  and the environment without. */
const SCREEN_RADIANCE = {
  name: 'resolvedRadiance',
  disabled: 'reflectionView.enabled.x==0.0',
  fallback: (rough: string) => `reflectedRadiance(P,N,R,${rough})`,
} satisfies ScreenRadiance

/** A program's lobe and fade (`ScreenRadiance`); a `mirror` of its own walks the depth bounds. */
const screenReflectionWgsl = (lobe: ScreenLobe & Pick<ScreenRadiance, 'maxRoughness'> = {}) => `
// \`enabled\`: x the switch, yz the size the image draws in the source, which may be smaller, w the
// rough trace's seed.
struct ReflectionView{matrix:mat4x4f,enabled:vec4f,}
@group(1) @binding(0) var reflectionColor:texture_2d<f32>;
@group(1) @binding(1) var reflectionDepth:texture_depth_2d;
@group(1) @binding(2) var<uniform> reflectionView:ReflectionView;
fn reflectionProject(p:vec4f)->vec4f{let c=reflectionView.matrix*p;return vec4f(c.x,-c.y,c.z,c.w);}
fn reflectionSize()->vec2f{return reflectionView.enabled.yz;}
fn reflectionDepthAt(p:vec2i)->f32{return textureLoad(reflectionDepth,p,0);}
fn reflectionClearDepth()->f32{return 0.0;}
// The reprojected source (source.ts): alpha 0 where the last image did not see the point.
fn reflectionHitAt(p:vec2i)->vec4f{return textureLoad(reflectionColor,p,0);}
${screenTraceShader('wgsl')}
${REFLECTION_CONE_WGSL}${lobe.mirror ? HIZ_TRACE_WGSL : ''}
${screenRadianceShader('wgsl', { ...SCREEN_RADIANCE, ...lobe })}`

export const SCREEN_REFLECTION_WGSL = screenReflectionWgsl()

/** The blended march's surface (`translucentReflectionMarch`), from the opaque walk's own tests
 *  (`reflectionContinues`, `reflectionSideSlope`, `traceShader.ts`):
 *  - `reflectionDepthClamped`: the depth at `p`, the screen's nearest pixel off it.
 *  - `reflectionPlane`: the depth's change per pixel on each axis at `p` (depth `z`), the central
 *    difference of the neighbours where they continue the surface; at a rim, the background on one
 *    side, the step to the drawn one: the surface runs on to its edge; none at a crease or
 *    silhouette, nor against the background on both sides. `z` one where both axes continue it.
 *    `reflectionOnPlane`: its depth at screen point `at`.
 *  - `reflectionCarries`: whether the plane read at `last` (depth `lastDepth`, the clear depth for
 *    none) still holds at `p`: whole, and predicting `p`'s depth `z` within `span`, the walk's
 *    depth change over `p` — finer than its crossing resolves —, or within the depth's own
 *    precision, two units of f32's last place (24-bit depth's step near the far plane is finer).
 *    The march reads a surface's plane once, not at each of its pixels. */
const BLENDED_PLANE_WGSL = `
fn reflectionDepthClamped(p:vec2i)->f32{
 return reflectionDepthAt(clamp(p,vec2i(0),vec2i(reflectionSize())-vec2i(1)));
}
fn reflectionPlane(p:vec2i,z:f32)->vec3f{
 var left:f32=reflectionDepthClamped(p-vec2i(1,0));var right:f32=reflectionDepthClamped(p+vec2i(1,0));
 var down:f32=reflectionDepthClamped(p-vec2i(0,1));var up:f32=reflectionDepthClamped(p+vec2i(0,1));
 var plane:vec3f=vec3f(0.0,0.0,1.0);
 if(reflectionContinues(z,left,right)){plane.x=0.5*(right-left);}else{plane.x=reflectionSideSlope(z,left,right);plane.z=0.0;}
 if(reflectionContinues(z,down,up)){plane.y=0.5*(up-down);}else{plane.y=reflectionSideSlope(z,down,up);plane.z=0.0;}
 return plane;
}
fn reflectionOnPlane(p:vec2i,z:f32,plane:vec3f,at:vec2f)->f32{
 return z+dot(plane.xy,at-vec2f(p)-vec2f(0.5));
}
fn reflectionCarries(plane:vec3f,last:vec2i,lastDepth:f32,p:vec2i,z:f32,span:f32)->bool{
 return lastDepth!=reflectionClearDepth()&&plane.z==1.0&&abs(lastDepth+dot(plane.xy,vec2f(p-last))-z)<=max(span,abs(z)*exp2(-22.0));
}`

/** Coarse samples of a blended surface's ray: the translucent trace is coarse; each one that finds
 *  the ray behind the depth, or past the edge of the last one's surface, walks the pixels since the
 *  last one. */
const TRANSLUCENT_TRACE_SAMPLES = 32

/** A blended surface's (`../webgpu/blend/shader.ts`), as translucency traces it:
 *  one mirror ray in a fixed count of samples over
 *  the opaque depth, a miss on the fallback at the surface's roughness, the lobe faded to it by
 *  `saturate(2 - 6.6·roughness)`. The pixels since the last sample are walked one by one where a
 *  sample finds the ray behind the depth, or behind the plane of the last sample's surface where
 *  that surface does not run on to this sample (its edge, a thin object a sample fell on); a pixel
 *  answers where the ray crosses the plane its depth and continuous neighbours give
 *  (`reflectionPlane`), or lies behind it by no more than twice the ray's
 *  depth change over the pixel.
 *  A depth compared flat, at the pixel's centre, missed most crossings of a grazing ray, whose
 *  depth changes over a pixel far less than the surface's: a band of hits and misses on a glossy
 *  pane; and a ray behind a surface just before its edge was never walked: a jagged rim.
 *  The samples start at a per-pixel, per-image fraction of their spacing
 *  (`translucentReflectionOffset`), which the temporal accumulation averages: an object no sample
 *  falls on in one image is found in the share of the images whose samples reach it.
 *  The surface is in no depth, so its former cone (`coneShader.ts`) took the first mip cell whose
 *  near/far bounds met the widened ray — a cell mixing the floor seen through the pane with what
 *  stands before it — and kept that cell's coverage, the rest to the fallback: a hit or a miss
 *  that flipped cell by cell, the staircase ghost on a glossy pane that crawled as the view turned.
 *  The whole pixel walk is as clean but costs a pane's every pixel the screen's width. A perfect
 *  mirror keeps the depth pyramid's walk (`resolvedReflectionRay`, `screenReflection`), and so does
 *  the mirror transition, the march's ray traced once (`ScreenRadiance.march`). */
export const TRANSLUCENT_SCREEN_REFLECTION_WGSL = `${screenReflectionWgsl({
  march: 'translucentReflectionMarch',
  maxRoughness: TRANSLUCENT_SCREEN_REFLECTION_MAX_ROUGHNESS,
})}${BLENDED_PLANE_WGSL}
// Where the samples start in their spacing: interleaved gradient noise over the pixel, turned each image
// (\`translucentReflectionFrame\`): every pixel's offsets fill its interval evenly over the still
// images the temporal accumulation averages. Otherwise (a negative turn), none: the same samples
// everywhere, never a dither nothing averages.
fn translucentReflectionOffset(p:vec2i)->f32{
 let turn=translucentReflectionFrame();
 if(turn<0.0){return 0.0;}
 return fract(${interleavedGradientWgsl('vec2f(p)')}+turn);
}
fn translucentReflectionMarch(P:vec3f,R:vec3f)->vec4f{${REFLECTION_SEGMENT}
 let origin=vec2i(floor(start));
 let pixels=max(abs(delta.x),abs(delta.y));
 let samples=clamp(i32(ceil(pixels)),1,${TRANSLUCENT_TRACE_SAMPLES});
 let spacing=1.0/f32(samples);
 let offset=translucentReflectionOffset(origin);
 var last=0.0;
 // The depths of the last two samples, the first a spacing before the first sample.
 var lastDepth=reflectionDepthClamped(vec2i(floor(start-delta*offset*spacing)));
 var priorDepth=reflectionClearDepth();
 for(var k=1;k<=samples+1&&last<1.0;k++){
  let next=min((f32(k)-offset)*spacing,1.0);
  let at=start+delta*next;
  let z=reflectionDepthClamped(vec2i(floor(at)));
  let ray=mix(a.z,b.z,next);
  var behind=z!=reflectionClearDepth()&&ray<=z;
  // The last sample's surface does not run on to this one — its step to it, brought to the
  // spacing (the last sample, at the ray's end, may be nearer), does not continue the step before:
  // the ray may have crossed it before its edge, a rim or a thin object a sample fell on. Its plane,
  // carried here, tells; where it has a slope on neither axis or one, the ray leaving for the
  // background is walked. The walk below starts on that pixel and keeps a whole plane.
  let lastPixel=vec2i(floor(start+delta*last));
  var plane=vec3f(0.0);
  let stepped=select(lastDepth+(z-lastDepth)*spacing/(next-last),z,z==reflectionClearDepth());
  if(!behind&&k>1&&lastDepth!=reflectionClearDepth()&&!reflectionContinues(lastDepth,priorDepth,stepped)){
   plane=reflectionPlane(lastPixel,lastDepth);
   behind=ray<=reflectionOnPlane(lastPixel,lastDepth,plane,at)||(z==reflectionClearDepth()&&plane.z==0.0);
  }
  priorDepth=lastDepth;lastDepth=z;
  // The walk, from the last sample. A ray already behind the first surface it meets there, by no
  // more than that surface's depth changes over a pixel, may have crossed it before that sample,
  // whose depth, read at its pixel's centre and not where the ray passes, hid the crossing: the
  // walk is then made again from the sample before.
  var walkFrom=last;
  // The last pixel walked, its depth and plane (\`reflectionCarries\`): first the edge sample's,
  // whose depth \`priorDepth\` holds since the shift above; with no edge plane read, none.
  var planeDepth=priorDepth;var planePixel=lastPixel;
  for(var walks=0;behind&&walks<2;walks++){
   let steps=max(1,i32(ceil(pixels*(next-walkFrom))));
   var behindFirst=false;var met=false;
   for(var j=0;j<steps;j++){
    let entered=mix(walkFrom,next,f32(j)/f32(steps));let exited=mix(walkFrom,next,f32(j+1)/f32(steps));
    let pixel=vec2i(floor(start+delta*(entered+exited)*0.5));
    if(all(pixel==origin)){continue;}
    let depth=reflectionDepthClamped(pixel);
    if(depth==reflectionClearDepth()){planeDepth=depth;continue;}
    let before=mix(a.z,b.z,entered);let after=mix(a.z,b.z,exited);
    if(!reflectionCarries(plane,planePixel,planeDepth,pixel,depth,abs(after-before))){
     plane=reflectionPlane(pixel,depth);
    }
    planeDepth=depth;planePixel=pixel;
    // How far the ray is before the surface where it enters and leaves the pixel; behind it, a
    // tolerance of twice the ray's span in depth:
    // a grazing ray that slipped under a surface between two pixels is taken, never one passing
    // far behind a nearer object.
    let inFront=before-reflectionOnPlane(pixel,depth,plane,start+delta*entered);
    let outFront=after-reflectionOnPlane(pixel,depth,plane,start+delta*exited);
    if(min(inFront,outFront)<=0.0&&max(inFront,outFront)>=-2.0*abs(after-before)){
     return reflectionHitAt(pixel);
    }
    if(!met){met=true;behindFirst=inFront<0.0&&inFront>=-abs(plane.x)-abs(plane.y);}
   }
   behind=behindFirst&&walkFrom>0.0;
   walkFrom=max(walkFrom-spacing,0.0);planeDepth=reflectionClearDepth();
  }
  last=next;
 }
 return vec4f(0.0);
}`

/** The water composite's (`../webgpu/water/compositeWgsl.ts`): its mirror ray bounded
 *  (`boundedReflectionRay`), the fluids' own quality tier (AGENTS.md rule 1), on the depth
 *  bounds `reflectionPlan` makes for it. */
export const BOUNDED_SCREEN_REFLECTION_WGSL = screenReflectionWgsl({
  mirror: 'boundedReflectionRay',
})

/** The rough history holds a ratio mean; a pixel that has only drawn below-horizon samples holds
 *  no weight, and leaves its whole lobe to the environment reflection, never black. */
const HELD_REFLECTION_WGSL = `
@group(1) @binding(3) var roughHistory:texture_2d<f32>;
fn heldReflection(P:vec3f)->vec4f{
 let projected=reflectionProject(vec4f(P,1.0));
 let at=vec2i((projected.xy/projected.w*0.5+vec2f(0.5))*reflectionSize());
 let held=textureLoad(roughHistory,at,0);
 if(held.a>0.0){return vec4f(held.rgb,0.0);}
 return vec4f(0.0,0.0,0.0,1.0);
}`

/** Install screen hits at the one reflection-model entry of either program, preserving its
 *  existing miss behavior: the probes with bounce, the environment without. */
export function withScreenReflections(shader: string, history = false) {
  const reflection = history
    ? screenReflectionWgsl({ filtered: 'heldReflection(P)' }) + HELD_REFLECTION_WGSL
    : SCREEN_REFLECTION_WGSL
  return (
    shader.replace(
      ')*reflectedRadiance(P,N,reflect(-V,N),',
      ')*resolvedRadiance(P,N,reflect(-V,N),',
    ) + reflection
  )
}
