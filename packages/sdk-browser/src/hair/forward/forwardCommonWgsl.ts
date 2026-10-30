import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { gridWalkAdvance } from '../gridWalkWgsl.ts'
import { HAIR_VIEW_WGSL } from '../ribbonWgsl.ts'
import { hairSpineClip } from '../rasterWgsl.ts'
import {
  FORWARD_BIN_TILE,
  FORWARD_COUNTER,
  FORWARD_LAYER,
  FORWARD_THREADS,
  FORWARD_WALK_STEPS,
} from './forwardMath.ts'

/** The words of the parameters block (`ForwardParams`). */
export const FORWARD_PARAM_WORDS = 12

/** The parameters every pass of the forward raster reads (`params`, a uniform its host declares: group 0 binding 0, but the cull's, group 1 binding 1),
 *  and the view (`view`, `HairView`: group 0 binding 1, the cull's group 1 binding 0). */
export const FORWARD_PARAMS_WGSL = wgslBlock(
  'FORWARD_PARAMS_WGSL',
  [HAIR_VIEW_WGSL],
  `struct ForwardParams{size:vec2u,binRes:vec2u,rasterRes:vec2u,numBinners:u32,numRasterizers:u32,maxTiles:u32,capacity:u32,fullCoverage:f32,pad:u32}`,
)

/** The declarations of the parameters and the view of the passes over tiles, in group 0. */
export const FORWARD_BINDINGS_WGSL = wgslBlock(
  'FORWARD_BINDINGS_WGSL',
  [FORWARD_PARAMS_WGSL],
  `@group(0) @binding(0) var<uniform> params:ForwardParams;
@group(0) @binding(1) var<uniform> view:HairView;`,
)

/** The control point kinds the points are packed with: the kind on bits 24 and 25 of the fourth word, the radius on the low half. */
export const FORWARD_KIND_SHIFT = 24

/**
 * The control point `i` of the lit strands, from `points` (the position and, in the fourth word, the radius as a half float and the kind):
 * its clip position, its radius and its kind.
 */
export const forwardPoint = wgslBlock(
  'forwardPoint',
  [FORWARD_PARAMS_WGSL],
  `struct ForwardPoint{clip:vec4f,radius:f32,kind:u32}
fn forwardPoint(i:u32)->ForwardPoint{
 let p=points[i];
 let word=bitcast<u32>(p.w);
 return ForwardPoint(view.viewProj*vec4f(p.xyz,1.0),unpack2x16float(word).x,(word>>${FORWARD_KIND_SHIFT}u)&3u);
}`,
)

/** The segment of two clip positions cut to the view (the near and far planes and the four sides): whether anything of it lies inside, and the ends of what does, with the part of the segment they bound. */
export const forwardClipSegment = wgslBlock(
  'forwardClipSegment',
  [hairSpineClip],
  `struct ForwardCut{ok:bool,a:vec4f,b:vec4f,t:vec2f}
fn forwardClipSegment(h0:vec4f,h1:vec4f)->ForwardCut{
 let t=hairSpineClip(h0,h1);
 if(!(t.x<t.y)){return ForwardCut(false,h0,h1,t);}
 return ForwardCut(true,mix(h0,h1,t.x),mix(h0,h1,t.y),t);
}`,
)

/** A clip position in pixels, its depth and the reciprocal of its w. */
export const forwardToPixel = wgslFn(
  'forwardToPixel',
  [],
  `fn forwardToPixel(h:vec4f)->vec4f{
 let w=max(h.w,1e-9);
 let ndc=h.xyz/w;
 return vec4f((ndc.x*0.5+0.5)*f32(params.size.x),(0.5-ndc.y*0.5)*f32(params.size.y),ndc.z,1.0/w);
}`,
)

/** The tile coordinates and the work packed in words: a tile's x on the low half, its y on the high one. */
export const forwardPacking = wgslBlock(
  'forwardPacking',
  [],
  `fn packCoord(c:vec2u)->u32{return (c.x&0xffffu)|((c.y&0xffffu)<<16u);}
fn unpackCoord(w:u32)->vec2u{return vec2u(w&0xffffu,w>>16u);}
fn depthBits(z:f32)->u32{return bitcast<u32>(z);}
fn depthOf(bits:u32)->f32{return bitcast<f32>(bits);}`,
)

/** A barrier over the workgroup that also orders the storage buffers' writes: what a thread wrote is read by the others past it. */
export const groupSync = wgslFn(
  'groupSync',
  [],
  'fn groupSync(){storageBarrier();workgroupBarrier();}',
)

/**
 * THE WALK OF A SEGMENT OVER THE TILES: from the tile of its first end to the tile of its last, one tile at a time along the segment (a digital
 * differential analyser from `start` to `finish`, in tiles). A direction with no part along an axis never steps along it. `walkDone` says the last tile was reached.
 */
export const forwardWalk = wgslBlock(
  'forwardWalk',
  [gridWalkAdvance],
  `const WALK_FAR=1e30;
struct Walk{coord:vec2f,delta:vec2f,step:vec2f,side:vec2f,end:vec2i}
fn walkStart(start:vec2f,finish:vec2f)->Walk{
 let d=finish-start;
 let len=length(d);
 let dir=select(vec2f(1.0,0.0),d/max(len,1e-20),len>1e-12);
 let moves=abs(dir)>vec2f(1e-9);
 let rcp=select(vec2f(WALK_FAR),1.0/dir,moves);
 var w:Walk;
 w.coord=floor(start);
 w.delta=select(vec2f(WALK_FAR),abs(rcp),moves);
 w.step=select(vec2f(0.0),sign(dir),moves);
 w.side=select(vec2f(WALK_FAR),(w.coord-start+max(w.step,vec2f(0.0)))*rcp,moves);
 w.end=vec2i(floor(finish));
 return w;
}
fn walkTile(w:Walk)->vec2i{return vec2i(w.coord);}
fn walkDone(w:Walk)->bool{return all(vec2i(w.coord)==w.end);}`,
)

/** The constants of the passes, as the kernels name them. */
export const FORWARD_CONSTANTS_WGSL = wgslBlock(
  'FORWARD_CONSTANTS_WGSL',
  [],
  `const BIN_TILE=${FORWARD_BIN_TILE}u;
const THREADS=${FORWARD_THREADS}u;
const WALK_STEPS=${FORWARD_WALK_STEPS};
const COUNTER_BINNED=${FORWARD_COUNTER.binned}u;
const COUNTER_GATHERED=${FORWARD_COUNTER.gathered}u;
const COUNTER_WORK=${FORWARD_COUNTER.work}u;
const COUNTER_DEPTH_TAKEN=${FORWARD_COUNTER.depthTaken}u;
const COUNTER_COLOR_TAKEN=${FORWARD_COUNTER.colorTaken}u;
const LAYER_COUNTED=${FORWARD_LAYER.counted}u;
const LAYER_WRITTEN=${FORWARD_LAYER.written}u;
const LAYER_CURRENT=${FORWARD_LAYER.current}u;
const LAYER_PREVIOUS=${FORWARD_LAYER.previous}u;
const LAYER_MIN=${FORWARD_LAYER.minDepth}u;
const LAYER_MAX=${FORWARD_LAYER.maxDepth}u;
const LAYER_COUNT=${FORWARD_LAYER.count}u;`,
)
