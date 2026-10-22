import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { isFiniteWord } from '../../../../../math/src/wgsl/integer.ts'
import { ndcToUv, uvToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { BOUNDED_READ_WGSL, BOUNDS_FIELD, TRACE_DOWNSAMPLE } from './reconstructLayout.ts'

/** The reconstruction's uniform: the matrices at the eye, the reconstructed view, the traced
 *  texel's pixel of the cycle, the depth terms, the two distances, the bounds of the traced and
 *  the history images' reads (`writeSafeBounds`, `reconstructLayout.ts`) and the scales from the
 *  view's to the textures' coordinates of the two, in `xy` and `zw`. */
export const RECONSTRUCT_VIEW = fieldLayout('ReconstructView', [
  ['inverseViewProj', 'mat4x4f'],
  ['previousViewProj', 'mat4x4f'],
  ['destination', 'vec4f'],
  ['offset', 'vec4f'],
  ['depthTerms', 'vec4f'],
  ['distances', 'vec4f'],
  ['traced', BOUNDS_FIELD],
  ['history', BOUNDS_FIELD],
  ['uvScales', 'vec4f'],
] as const)

/** Where the reconstruction binds what it reads, in group 0. The history images (4 to 6) are bound
 *  by the program of an image that has a history. */
export const RECONSTRUCT_BINDING = {
  view: 0,
  colour: 1,
  secondary: 2,
  depth: 3,
  historyColour: 4,
  historySecondary: 5,
  historyDepth: 6,
  sampler: 7,
} as const

const B = RECONSTRUCT_BINDING

/** The depth beyond which a depth is read as the largest a half float holds, kilometres. */
const FAR_DEPTH_KM = 60000
/** How much nearer or further the history's scene depth may be than this image's before the new
 *  sample replaces it, kilometres. */
const NEW_SAMPLE_KM = 2
/** How much the closest depths of the new and the history sample may differ before the history is
 *  replaced by the new sample, kilometres. */
const HISTORY_EDGE_KM = 1

const COMMON = `
${RECONSTRUCT_VIEW.wgsl}
@group(0) @binding(${B.view}) var<uniform> view:ReconstructView;
@group(0) @binding(${B.colour}) var tracedColour:texture_2d<f32>;
@group(0) @binding(${B.secondary}) var tracedSecondary:texture_2d<f32>;
@group(0) @binding(${B.depth}) var tracedDepth:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var linearSampler:sampler;
struct Reconstructed{
 @location(0) colour:vec4f,
 @location(1) secondary:vec4f,
 @location(2) depth:vec4f,
}
struct DepthData{front:f32,scene:f32,range:vec2f}
fn depthData(v:vec4f)->DepthData{return DepthData(v.x,v.y,v.zw);}
fn depthVector(d:DepthData)->vec4f{return vec4f(d.front,d.scene,d.range);}
fn sampleTraced(t:texture_2d<f32>,uv:vec2f)->vec4f{return sampleBounded(t,view.traced,uv*view.uvScales.xy);}
`

const HISTORY = `
@group(0) @binding(${B.historyColour}) var historyColour:texture_2d<f32>;
@group(0) @binding(${B.historySecondary}) var historySecondary:texture_2d<f32>;
@group(0) @binding(${B.historyDepth}) var historyDepth:texture_2d<f32>;
fn sampleHistory(t:texture_2d<f32>,uv:vec2f)->vec4f{return sampleBounded(t,view.history,uv*view.uvScales.zw);}
fn finite4(v:vec4f)->bool{
 return isFiniteWord(bitcast<u32>(v.x))&&isFiniteWord(bitcast<u32>(v.y))&&isFiniteWord(bitcast<u32>(v.z))&&isFiniteWord(bitcast<u32>(v.w));
}
fn finite2(v:vec2f)->bool{return isFiniteWord(bitcast<u32>(v.x))&&isFiniteWord(bitcast<u32>(v.y));}
fn deviceZOfDepth(depthM:f32)->f32{
 return (view.depthTerms.x*depthM+view.depthTerms.y)/(view.depthTerms.z*depthM+view.depthTerms.w);
}
fn fixupDepth(d:DepthData)->DepthData{
 var r=d;
 r.front=select(d.front,HALF_MAX,d.front>${FAR_DEPTH_KM}.0);
 r.scene=select(d.scene,HALF_MAX,d.scene>${FAR_DEPTH_KM}.0);
 r.range=select(d.range,vec2f(HALF_MAX),d.range>vec2f(${FAR_DEPTH_KM}.0));
 return r;
}
struct Taps{colour:vec4f,secondary:vec4f,depth:DepthData}
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let pixel=vec2i(position.xy);
 let cell=pixel/${TRACE_DOWNSAMPLE};
 let sub=pixel-cell*${TRACE_DOWNSAMPLE};
 let tracedNow=sub.x==i32(view.offset.x)&&sub.y==i32(view.offset.y);
 let screenUv=position.xy*view.destination.zw;
 let screen=uvToNdc(screenUv);
 let tracedDepth4=loadBounded(tracedDepth,view.traced,cell);
 let frontKm=tracedDepth4.x;
 let current=vec4f(screen,deviceZOfDepth(frontKm*1000.0),1.0);
 let previous=view.previousViewProj*(view.inverseViewProj*current);
 let velocity=screen-previous.xy/previous.w;
 let previousUv=ndcToUv(screen-velocity);
 let validPrevious=all(previousUv>vec2f(0.0))&&all(previousUv<vec2f(1.0))&&frontKm>=view.distances.x;
 let fresh=Taps(loadBounded(tracedColour,view.traced,cell),loadBounded(tracedSecondary,view.traced,cell),fixupDepth(depthData(tracedDepth4)));
 let newDepth=fresh.depth;
 let oldDepth=fixupDepth(depthData(sampleHistory(historyDepth,previousUv)));
 let disoccluded=any(newDepth.range<vec2f(view.distances.y))||any(oldDepth.range<vec2f(view.distances.y))||newDepth.scene<view.distances.y||oldDepth.scene<view.distances.y;
 let useNew=tracedNow||(disoccluded&&((abs(newDepth.range.x-newDepth.range.y)>${NEW_SAMPLE_KM}.0&&abs(newDepth.range.x-newDepth.scene)<abs(newDepth.range.y-newDepth.scene))||oldDepth.scene<newDepth.scene-${NEW_SAMPLE_KM}.0||oldDepth.scene>newDepth.scene+${NEW_SAMPLE_KM}.0));
 var taps=fresh;
 if(!useNew&&validPrevious){
  taps=Taps(sampleHistory(historyColour,previousUv),sampleHistory(historySecondary,previousUv),oldDepth);
  if(abs(newDepth.range.x-oldDepth.range.x)>${HISTORY_EDGE_KM}.0){taps=fresh;}
  if(!(finite4(taps.colour)&&finite4(taps.secondary)&&finite2(vec2f(taps.depth.front,taps.depth.scene)))){
   let empty=vec4f(0.0,0.0,0.0,1.0);
   taps=Taps(empty,empty,DepthData(1000.0,1000.0,vec2f(1000.0)));
  }
 }else if(!useNew){
  taps=Taps(sampleTraced(tracedColour,screenUv),sampleTraced(tracedSecondary,screenUv),depthData(sampleTraced(tracedDepth,screenUv)));
 }
 return Reconstructed(taps.colour,taps.secondary,depthVector(taps.depth));
}
`

const FIRST = `
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 return Reconstructed(sampleTraced(tracedColour,screenUv),sampleTraced(tracedSecondary,screenUv),sampleTraced(tracedDepth,screenUv));
}
`

/**
 * THE RECONSTRUCTION, per pixel of the reconstructed image, from the traced one and the image it
 * reconstructed before (`history`; the first image after a cut has none, and bilinearly upsamples the
 * traced image alone). It writes the colour, the secondary colour and the depth images.
 *
 * With a history, per pixel:
 * - it takes the traced texel it lies in, and is the pixel traced now when its place among the
 *   texel's four pixels is the cycle's offset;
 * - its place in the last image is found from its cloud's front depth — read as the depth along the
 *   view axis, an approximation —, through the clip matrices of both images without jitter; the
 *   reprojection is valid on screen and where that front depth is not nearer than its distance;
 * - depths beyond 60000 km read as the largest half float; the new sample replaces the history
 *   where, near the eye (a depth of the texel's range, or the scene's, under the distance that
 *   disables the disocclusion), the texel's closest and furthest depths differ by more than 2 km
 *   and the scene depth is the closest's, or the history's scene depth is more than 2 km nearer or
 *   further than the new one's;
 * - the pixel traced now takes the new sample; else a valid reprojection takes the history by a
 *   bilinear read, the new sample where the closest depths differ by more than 1 km, and an empty
 *   cloud at 1000 km where anything it read is not finite; else the traced image is read bilinearly.
 * The traced image is read through its bounds, so that no read reaches past the view. The
 * program of each kind (with a history or not) is made once.
 */
const programs = new Map<boolean, string>()
export function reconstructProgram(history: boolean) {
  let code = programs.get(history)
  if (code === undefined) {
    const uses = [FULLSCREEN_VERTEX, BOUNDED_READ_WGSL]
    if (history) uses.push(HALF_MAX, isFiniteWord, ndcToUv, uvToNdc)
    programs.set(history, (code = wgslProgram(`${COMMON}${history ? HISTORY : FIRST}`, uses)))
  }
  return code
}
