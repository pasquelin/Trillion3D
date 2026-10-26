import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { rayBoxSpan, rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { globalDistanceFieldReadWgsl } from './globalReadWgsl.ts'

/**
 * A RAY MARCHED THROUGH THE GLOBAL DISTANCE FIELD (`gdfTrace`), over the reads of `globalReadWgsl.ts`: the
 * distance to the nearest surface stepped along the ray, the field's clipmaps in turn from the finest that
 * holds the ray's start, until a surface is met. Lengths are the field's unit, the centimetre, the positions
 * TRANSLATED (`gdfTranslated`).
 *
 * THE MARCH. The ray starts at `start + minTrace · dir` in the clipmap that holds that point (`gdfClipmapAt`: the
 * finest whose box holds it by more than a voxel's half). Each clipmap is traversed between where the ray enters its
 * box, drawn in by a voxel's half, and where it leaves it (`gdfLineBoxIntersect`), no earlier than the
 * time the clipmap before left off; the next resumes there. In a clipmap, at most `traceSteps` steps: at
 * each, the coarse mip is read at the sample, its distance in the range of the mip; where the sample lies
 * in an allocated page and the mip is under the distance at which the pages take over, the page is read
 * instead, filtered, in the clipmap's range (four voxels either side of a surface), and a page flagged as
 * reached by two-sided meshes alone (its coverage bit) has the coverage the coverage atlas gives there,
 * filtered, a voxel's 0 or 1 (`gdfCoverageSample`) — a coverage of 0 whole with the view's
 * `simpleCoverage` flag, the atlas unread —, else 1. The largest distance read so far
 * is kept (`maxDistance`).
 *
 * THE SURFACE. A sample is on the surface where its distance is under the amount the surface is
 * expanded by: a voxel's half times the share of the time (the ray's time from the clipmap's bias, or the
 * largest distance read so far, by `expandByTime`) over a voxel, held to 1, times the scale of the
 * coverage (`expandNotCovered` to `expandCovered`). The hit time is the sample's time plus its distance, less the
 * expansion, from 0 on. A dithered ray (`dithered`) is stopped at a sample that is not covered only where
 * the noise of its step and of its whole trace, at the pixel `ditherCoord` and the turn `turn` of the images, are under the thresholds
 * (`ditherStep`, `ditherTrace`) once weighed by the share not covered; a covered one always.
 * Else the step is the distance times `stepFactor`, at least a voxel's half times `minStepFactor`, times
 * `minStepNotCovered` to 1 by the coverage. The result (`GdfTraceResult`): the hit time, -1 where the ray met nothing,
 * the clipmap it was in, the steps taken in all and the amount the surface was expanded by. A ray also names the
 * largest distance it starts from (`initialMax`, for a surface expanded by it), a start and an end bias in voxels
 * of each clipmap (`rayBias`, `rayEndBias`) and, by `gdfTraceInput`, nothing else: no dither, expanded by the time. `gdfTraceRay` is the ray the callers share, from a world point.
 *
 * `gdfNormal`: the direction the distance grows in at a point of a clipmap, the central difference of the pages a half voxel
 * either side along each axis, normalised, the `fallback` where it is under 0.001. `gdfClipRayOutside`: the ray
 * from `origin` along `dir`, `length` long, drawn out of the outermost clipmap's box — where it leaves it, pulled back
 * by the share of the length that `steps` jittered steps of a trace starting there span —, as the distance it
 * starts at and the length left; unchanged where it never meets the box. Both need a field of one clipmap at least.
 */
const GDF_TRACE_TEXT = `
struct GdfTraceInput{start:vec3f,dir:vec3f,minTrace:f32,maxTrace:f32,stepFactor:f32,minStepFactor:f32,expandByTime:bool,initialMax:f32,rayBias:f32,rayEndBias:f32,dithered:bool,ditherCoord:vec2f,turn:f32,}
struct GdfTraceResult{hitTime:f32,clipmap:u32,steps:u32,expand:f32,}
struct GdfClipped{start:f32,length:f32,}
/** A ray from \`start\` along \`dir\` between \`minTrace\` and \`maxTrace\`: expanded by the time, not dithered, no bias. */
fn gdfTraceInput(start:vec3f,dir:vec3f,minTrace:f32,maxTrace:f32,stepFactor:f32,minStepFactor:f32)->GdfTraceInput{
 return GdfTraceInput(start,dir,minTrace,maxTrace,stepFactor,minStepFactor,true,0.0,0.0,0.0,false,vec2f(0.0),0.0);
}
/** The ray from the world point \`start\` (centimetres) along \`dir\` between \`begin\` and \`end\`, marched by \`stepFactor\`: its surface expanded by the ray's
 *  time where \`expandByTime\`, else by the largest distance read; where \`dithered\`, stopped on an uncovered sample by the noise of the texel \`coord\` and of \`turn\`. */
fn gdfTraceRay(start:vec3f,dir:vec3f,begin:f32,end:f32,stepFactor:f32,expandByTime:bool,dithered:bool,coord:vec2u,turn:f32)->GdfTraceResult{
 var input=gdfTraceInput(gdfTranslated(start),dir,begin,end,stepFactor,1.0);
 input.expandByTime=expandByTime;
 input.dithered=dithered;
 input.ditherCoord=vec2f(coord);
 input.turn=turn;
 return gdfTrace(input);
}
fn gdfClipmapAt(p:vec3f)->u32{
 for(var clipmap=0u;clipmap<gdfView.clipmaps;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  if(gdfBoxDistanceInside(box.xyz,box.w,p)>box.w*gdfView.texel){return clipmap;}
 }
 return 0u;
}
fn gdfLineBoxIntersect(start:vec3f,end:vec3f,low:vec3f,high:vec3f)->vec2f{
 return saturate(rayBoxSpan(low,high,start,rayInverseDirection(end-start)));
}
fn gdfTrace(input:GdfTraceInput)->GdfTraceResult{
 var out=GdfTraceResult(-1.0,0u,0u,0.0);
 let traceNoise=interleavedGradientNoise(input.ditherCoord,input.turn);
 var maxDistance=input.initialMax;
 var minTime=input.minTrace;
 let first=gdfClipmapAt(input.start+input.minTrace*input.dir);
 for(var clipmap=first;clipmap<gdfView.clipmaps&&out.hitTime<0.0;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  let voxelExtent=box.w*gdfView.texel;
  let minStep=input.minStepFactor*voxelExtent;
  let bias=voxelExtent*input.rayBias;
  let span=input.maxTrace-voxelExtent*input.rayEndBias;
  let inner=box.w-voxelExtent;
  let times=gdfLineBoxIntersect(input.start,input.start+input.dir*span,box.xyz-vec3f(inner),box.xyz+vec3f(inner))*span;
  let begin=max(max(times.x,minTime),bias);
  if(begin<times.y){
   minTime=times.y;
   var time=begin;
   let range=gdfInfluenceRange(clipmap);
   var taken=0u;
   while(taken<gdfView.traceSteps){
    let at=input.start+input.dir*time;
    let mipValue=gdfMipSample(gdfMipUv(at,clipmap));
    var toSurface=gdfDecode(mipValue,gdfView.mipFactor*range);
    var coverage=1.0;
    let page=gdfPageAt(gdfVolumeUv(at,clipmap),clipmap);
    if(page.valid&&mipValue<gdfView.mipTransition){
     if(page.coverage){
      coverage=0.0;
      if((gdfView.flags&GDF_FLAG_SIMPLE_COVERAGE)==0u){coverage=gdfCoverageSample(page.page,page.local);}
     }
     toSurface=gdfDecode(gdfAtlasSample(page.page,page.local),range);
    }
    maxDistance=max(maxDistance,toSurface);
    let expandTime=select(maxDistance,time-bias,input.expandByTime);
    let expandScale=mix(gdfView.expandNotCovered,gdfView.expandCovered,coverage);
    let expand=voxelExtent*saturate(expandTime/(2.0*voxelExtent))*expandScale;
    var stops=toSurface<expand;
    if(stops&&input.dithered){
     let stepNoise=interleavedGradientNoise(input.ditherCoord,input.turn*f32(gdfView.traceSteps)+f32(taken));
     stops=stepNoise*(1.0-coverage)<=gdfView.ditherStep&&traceNoise*(1.0-coverage)<=gdfView.ditherTrace;
    }
    if(stops){
     out.hitTime=max(time+toSurface-expand,0.0);
     out.clipmap=clipmap;
     out.expand=expand;
     break;
    }
    time+=max(toSurface*input.stepFactor,minStep*mix(gdfView.minStepNotCovered,1.0,coverage));
    if(time>times.y){break;}
    taken++;
   }
   out.steps+=taken;
  }
 }
 return out;
}
fn gdfNormal(p:vec3f,clipmap:u32,fallback:vec3f)->vec3f{
 let uv=gdfVolumeUv(p,clipmap);
 let offset=0.5*gdfView.texel;
 let gradient=vec3f(
  gdfPageValue(fract(uv+vec3f(offset,0.0,0.0)),clipmap)-gdfPageValue(fract(uv-vec3f(offset,0.0,0.0)),clipmap),
  gdfPageValue(fract(uv+vec3f(0.0,offset,0.0)),clipmap)-gdfPageValue(fract(uv-vec3f(0.0,offset,0.0)),clipmap),
  gdfPageValue(fract(uv+vec3f(0.0,0.0,offset)),clipmap)-gdfPageValue(fract(uv-vec3f(0.0,0.0,offset)),clipmap));
 let size=sqrt(dot(gradient,gradient));
 return select(fallback,gradient/size,size>0.001);
}
fn gdfClipRayOutside(origin:vec3f,dir:vec3f,span:f32,steps:u32)->GdfClipped{
 var out=GdfClipped(0.0,span);
 let box=gdfView.centerExtent[gdfView.clipmaps-1u];
 let inner=box.w-box.w*gdfView.texel;
 let times=gdfLineBoxIntersect(origin,origin+dir*span,box.xyz-vec3f(inner),box.xyz+vec3f(inner));
 if(times.x<times.y){
  let leaves=max(times.y+(times.y-1.0)/f32(2u*steps-1u),0.0);
  out.start=leaves*span;
  out.length=max(span*(1.0-leaves),0.0);
 }
 return out;
}`

/** The march through the field and the helpers around it, over the reads at the bindings `first` on of the
 *  group `group` (`globalDistanceFieldReadWgsl`). */
export function globalDistanceFieldTraceWgsl(group: number, first: number) {
  return wgslBlock(
    `GLOBAL_DISTANCE_FIELD_TRACE_WGSL ${group}, ${first}`,
    [
      globalDistanceFieldReadWgsl(group, first),
      interleavedGradientNoise,
      rayInverseDirection,
      rayBoxSpan,
    ],
    GDF_TRACE_TEXT,
  )
}
