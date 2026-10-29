import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { edgeFunction } from '../../../math/src/wgsl/barycentric.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { SUBPIXEL_SAMPLES, MODE_DEPTH, MODE_ID } from '../visibility/raster/contract.ts'
import { visWorkDeclaration, visWriteWgsl } from '../visibility/raster/pixelWgsl.ts'
import { RASTER_SUBPIXEL_WGSL } from '../visibility/raster/triWgsl.ts'
import { HAIR_BAND_WGSL, HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { HAIR_RIBBON_WGSL } from './ribbonWgsl.ts'
import { hairListedPixel } from './tilesWgsl.ts'
import {
  HAIR_ID_BITS,
  HAIR_SAMPLE_OFFSET_STEPS,
  HAIR_SAMPLE_OFFSETS,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
  type HairSampleCount,
} from './visibilityMath.ts'
import {
  HAIR_INLINE_PIXELS,
  HAIR_LARGE_LANES,
  HAIR_TILE_GRID_BINDING,
  HAIR_TILE_LIST_BINDING,
  HAIR_TILE_META2_BINDING,
  HAIR_TILE_META_BINDING,
  HAIR_TILE_PARAMS_BINDING,
  HAIR_TILE_PRIMS2_BINDING,
  HAIR_TILE_PRIMS_BINDING,
} from './rasterLimits.ts'

/** The large ribbons a dispatch lists (the most workgroups a dispatch holds); one past it is drawn by its own
 *  thread, as a ribbon the list has no room for must be. */
const HAIR_LARGE_CAPACITY = 65535
/** The binding, in group 1, of the list of large ribbons; the arguments over it are bound after it. */
export const HAIR_LARGE_BINDING = 4
/** The words of the list of large ribbons (`large`): its count, then the segments. */
export const HAIR_LARGE_WORDS = 1 + HAIR_LARGE_CAPACITY
/** The words of the dispatch arguments over the list (`largeArgs`). */
export const HAIR_LARGE_ARGS_WORDS = 3

/** The first word of the identifier plane of the visibility buffer without the 64-bit word: the
 *  samples of the band's pixels, after the depth plane. */
export const samplePlane = wgslFn(
  'samplePlane',
  [HAIR_BAND_WGSL],
  'fn samplePlane()->u32{return band.plane;}',
)

/** The frame of the raster: the view's size, as the camera's viewport is for the cluster raster. */
const rasterViewport = wgslFn('rasterViewport', [], 'fn rasterViewport()->vec2f{return view.size;}')

/**
 * THE CUT OF A SEGMENT TO THE VIEW: the part of the segment from `h0` to `h1` (clip coordinates, the
 * depth reversed: the near plane at `z = w`, the far at `z = 0`) inside the six planes of the view,
 * `w ± x`, `w ± y`, `z` and `w − z` at least 0, as the parameters of its ends along it (homogeneous line
 * clipping: each plane raises the first end's parameter or lowers the second's to where the segment
 * crosses it). Empty, the first not below the second, where no part of it is inside: a segment that
 * leaves the view across one plane and comes back across another holds none either. A plane the
 * segment runs along keeps it whole or removes it.
 */
export const hairSpineClip = wgslFn(
  'hairSpineClip',
  [],
  `fn hairSpineClip(h0:vec4f,h1:vec4f)->vec2f{
 var t=vec2f(0.0,1.0);
 for(var plane=0u;plane<6u;plane++){
  let axis=plane/2u;
  let sign=select(-1.0,1.0,(plane&1u)==0u);
  let w=select(1.0,0.0,plane==4u);
  let b=w*vec2f(h0.w,h1.w)+sign*vec2f(h0[axis],h1[axis]);
  let denom=b.x-b.y;
  if(denom<0.0){t.x=max(t.x,b.x/denom);}
  else if(denom>0.0){t.y=min(t.y,b.x/denom);}
  else if(b.x<0.0){return vec2f(1.0,0.0);}
 }
 return t;
}`,
)

/** The bindings of the compute raster's tiles and lists (`binnedRasterPass.ts`): the sizes of the tile grid and of the rasters, the grid of
 *  tile counters, the tiles with their segments, the compacted ones, and the lists of the classified segments. */
const TILE_BINDINGS_TEXT = `struct TileParams{size:vec2u,cells:vec2u,shift:u32,tileSize:u32,binners:u32,rasterizers:u32,rasterizersNaive:u32,classifiers:u32,maxTiles:u32,listSize:u32}
@group(1) @binding(${HAIR_TILE_PARAMS_BINDING}) var<uniform> tp:TileParams;
@group(1) @binding(${HAIR_TILE_GRID_BINDING}) var<storage,read_write> grid:array<atomic<u32>>;
@group(1) @binding(${HAIR_TILE_META_BINDING}) var<storage,read_write> tileData:array<atomic<u32>>;
@group(1) @binding(${HAIR_TILE_PRIMS_BINDING}) var<storage,read_write> prims:array<u32>;
@group(1) @binding(${HAIR_TILE_LIST_BINDING}) var<storage,read_write> lists:array<atomic<u32>>;
@group(1) @binding(${HAIR_TILE_META2_BINDING}) var<storage,read_write> tileData2:array<atomic<u32>>;
@group(1) @binding(${HAIR_TILE_PRIMS2_BINDING}) var<storage,read_write> prims2:array<u32>;
// The list of the classified segments: the count of the software share, of the hardware share, then the software ones from the first word
// and the hardware ones from the last of the room, whose size is listSize.
const LIST_SOFTWARE=0u;
const LIST_HARDWARE=1u;
const LIST_ALL=2u;
override LIST:u32=LIST_ALL;
fn listedSegment(list:u32,k:u32)->u32{
 if(list==LIST_HARDWARE){return atomicLoad(&lists[1u+tp.listSize-k]);}
 return atomicLoad(&lists[2u+k]);
}`

/** The bindings of the raster, its constants and the sample positions. */
const rasterBindingsText = (
  samples: HairSampleCount,
  wide: boolean,
  offsets: readonly string[],
) => `@group(1) @binding(1) var sceneDepth:texture_depth_2d;
${visWorkDeclaration(wide, 2, 1, 'samples')}
@group(1) @binding(3) var<uniform> band:HairBand;
${TILE_BINDINGS_TEXT}
const SAMPLES=${samples}u;
const SUBPIXEL=${SUBPIXEL_SAMPLES}.0;
override MODE:u32=${MODE_DEPTH}u;
// The positions of the samples from the pixel's centre, in steps of the subpixel grid.
var<private> OFFSETS:array<vec2f,${samples}>=array<vec2f,${samples}>(${offsets.join(',')});
// The pixels a triangle may reach: the whole image until a kernel narrows it (a tile's window: the first column and row, then the ends).
var<private> clipBox:vec4u=vec4u(0u,0u,0xffffffffu,0xffffffffu);`

/** The bindings of the large ribbons: the list a dispatch fills, and the arguments of the dispatch that draws them. */
const LARGE_BINDINGS_TEXT = `// The large ribbons of the dispatch: the count, then their segments; and the arguments of the dispatch over them.
@group(1) @binding(${HAIR_LARGE_BINDING}) var<storage,read_write> large:array<atomic<u32>,${HAIR_LARGE_WORDS}>;
@group(1) @binding(${HAIR_LARGE_BINDING + 1}) var<storage,read_write> largeArgs:array<u32,${HAIR_LARGE_ARGS_WORDS}>;
const LARGE_CAPACITY=${HAIR_LARGE_CAPACITY}u;
const INLINE_PIXELS=${HAIR_INLINE_PIXELS}.0;`

/** The edge functions of a triangle and the span of its rows. */
const RASTER_EDGES_TEXT = `// An edge from u to v as a triangle tests it: walked from the lesser of its corners (by x, then y) to
// the other, its function times the sign that gives the edge's own, times the triangle's turn.
struct HairEdge{tail:vec2f,head:vec2f,sign:f32}
fn hairEdgeOf(u:vec2f,v:vec2f,turn:f32)->HairEdge{
 let forward=u.x<v.x||(u.x==v.x&&u.y<=v.y);
 return HairEdge(select(v,u,forward),select(u,v,forward),select(-turn,turn,forward));
}
fn hairEdgeAt(e:HairEdge,p:vec2f)->f32{return e.sign*edgeFunction(e.tail,e.head,p);}
// The least and the greatest x of the triangle abc within the rows y0 to y1.
fn rowSpan(a:vec2f,b:vec2f,c:vec2f,y0:f32,y1:f32)->vec2f{
 var lo=3.0e38;
 var hi=-3.0e38;
 var corners=array<vec2f,3>(a,b,c);
 for(var e=0u;e<3u;e++){
  let u=corners[e];
  let v=corners[(e+1u)%3u];
  if(u.y>=y0&&u.y<=y1){lo=min(lo,u.x);hi=max(hi,u.x);}
  for(var l=0u;l<2u;l++){
   let y=select(y0,y1,l==1u);
   if((u.y-y)*(v.y-y)<0.0){
    let x=u.x+(y-u.y)/(v.y-u.y)*(v.x-u.x);
    lo=min(lo,x);
    hi=max(hi,x);
   }
  }
 }
 return vec2f(lo,hi);
}`

/** The fill of a triangle on the subpixel grid. */
const RASTER_FILL_TEXT = `// The triangle of the corners s0, s1 and s2, on the subpixel grid (subpixelOf). A thread of lanes takes the rows
// lane.y apart by lanes.y and, in each, the pixels lane.x apart by lanes.x.
fn fillTriangle(s0:vec4f,s1:vec4f,s2:vec4f,code:u32,lane:vec2u,lanes:vec2u){
 var e01=s0.xy-s1.xy;
 var e12=s1.xy-s2.xy;
 var e20=s2.xy-s0.xy;
 let area=e01.y*e20.x-e01.x*e20.y;
 // Flat on the grid, it covers no sample under the fill rule.
 if(area==0.0){return;}
 // The weights are positive inside whichever way the triangle turns.
 let turn=select(-1.0,1.0,area>0.0);
 if(area>0.0){e01=-e01;e12=-e12;e20=-e20;}
 let nudge=vec3f(fillNudge(e12),fillNudge(e20),fillNudge(e01));
 let edge0=hairEdgeOf(s1.xy,s2.xy,turn);
 let edge1=hairEdgeOf(s2.xy,s0.xy,turn);
 let edge2=hairEdgeOf(s0.xy,s1.xy,turn);
 let size=view.size;
 let a=s0.xy/SUBPIXEL;
 let b=s1.xy/SUBPIXEL;
 let c=s2.xy/SUBPIXEL;
 let low=min(a,min(b,c));
 let high=max(a,max(b,c));
 if(high.x<0.0||high.y<0.0||low.x>=size.x||low.y>=size.y){return;}
 // The rows of the band alone: the other bands' dispatches take the rest.
 let rowLo=max(max(u32(clamp(floor(low.y),0.0,size.y-1.0)),band.first),clipBox.y);
 let rowHi=min(min(u32(clamp(floor(high.y),0.0,size.y-1.0)),band.end-1u),clipBox.w-1u);
 if(rowLo>rowHi){return;}
 let ids=MODE==${MODE_ID}u;
 for(var y=rowLo+lane.y;y<=rowHi;y+=lanes.y){
  let span=rowSpan(a,b,c,f32(y),f32(y)+1.0);
  if(span.x>span.y){continue;}
  let colLo=max(u32(clamp(floor(span.x),0.0,size.x-1.0)),clipBox.x);
  let colHi=min(u32(clamp(floor(span.y),0.0,size.x-1.0)),clipBox.z-1u);
  for(var x=colLo+lane.x;x<=colHi;x+=lanes.x){
   let opaque=textureLoad(sceneDepth,vec2i(i32(x),i32(y)),0);
   let centre=vec2f(f32(x)+0.5,f32(y)+0.5)*SUBPIXEL;
   for(var s=0u;s<SAMPLES;s++){
    let p=centre+OFFSETS[s];
    let w0=hairEdgeAt(edge0,p);
    let w1=hairEdgeAt(edge1,p);
    let w2=hairEdgeAt(edge2,p);
    if(w0<nudge.x||w1<nudge.y||w2<nudge.z){continue;}
    let depth=(w0*s0.z+w1*s1.z+w2*s2.z)/abs(area);
    if(!(depth>0.0)||depth<opaque){continue;}
    let at=((y-band.first)*u32(size.x)+x)*SAMPLES+s;
    let key=visKey(depth,0u);
    if(visPasses(at,key,ids)){visWrite(at,key,code,ids);}
   }
  }
 }
}`

/** A segment's ribbon: its corners, its box and its draw. */
const RASTER_RIBBON_TEXT = `// The rank of corner k of a segment's six among the ribbon's four: its tip adds 1, its right side 2.
fn cornerRank(k:u32)->u32{return select(0u,1u,cornerTip(k))+select(0u,2u,cornerRight(k));}
// A segment's ribbon: its four corners by their rank, at the cut, on the subpixel grid, and its identifier.
struct Ribbon{corners:array<vec4f,4>,code:u32,ok:bool}
fn ribbonOf(segment:u32)->Ribbon{
 var ribbon:Ribbon;
 if(segment>=inst.ids.y||!segmentDrawn(segment)){return ribbon;}
 let first=spineAt(segment);
 let second=spineAt(segment+1u);
 if(!first.ok||!second.ok){return ribbon;}
 let t=hairSpineClip(view.viewProj*vec4f(first.position,1.0),view.viewProj*vec4f(second.position,1.0));
 if(!(t.x<t.y)){return ribbon;}
 let left0=cornerClip(first,false);
 let left1=cornerClip(second,false);
 let right0=cornerClip(first,true);
 let right1=cornerClip(second,true);
 ribbon.corners=array<vec4f,4>(subpixelOf(mix(left0,left1,t.x)),subpixelOf(mix(left0,left1,t.y)),subpixelOf(mix(right0,right1,t.x)),subpixelOf(mix(right0,right1,t.y)));
 ribbon.code=(segment&${2 ** HAIR_ID_BITS - 1}u)|((inst.ids.x&${2 ** (32 - HAIR_ID_BITS) - 1}u)<<${HAIR_ID_BITS}u);
 ribbon.ok=true;
 return ribbon;
}
// The box the corners span, in pixels: the low corner then the high one.
fn ribbonBox(corners:array<vec4f,4>)->vec4f{
 let low=min(min(corners[0].xy,corners[1].xy),min(corners[2].xy,corners[3].xy))/SUBPIXEL;
 let high=max(max(corners[0].xy,corners[1].xy),max(corners[2].xy,corners[3].xy))/SUBPIXEL;
 return vec4f(low,high);
}
fn drawRibbon(ribbon:Ribbon,lane:vec2u,lanes:vec2u){
 var corners=ribbon.corners;
 for(var k=0u;k<6u;k+=3u){
  fillTriangle(corners[cornerRank(k)],corners[cornerRank(k+1u)],corners[cornerRank(k+2u)],ribbon.code,lane,lanes);
 }
}`

/** The kernels: the small ribbons by thread, the large ones by workgroup and the dispatch over the listed ones. */
const RASTER_KERNELS_TEXT = `// The naive raster: a fixed number of groups (rasterizersNaive) walk the segments of LIST (the software share, the hardware
// share, or every segment) a batch of threads at a time, a thread a segment, the way the reference's naive rasterizer walks them.
@compute @workgroup_size(WORKGROUP_THREADS) fn hairRaster(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 var count=inst.ids.y;
 if(LIST!=LIST_ALL){count=atomicLoad(&lists[LIST]);}
 let batches=(count+WORKGROUP_THREADS-1u)/WORKGROUP_THREADS;
 let loops=(batches+tp.rasterizersNaive-1u)/tp.rasterizersNaive;
 for(var round=0u;round<loops;round++){
  let k=(round+block.x*loops)*WORKGROUP_THREADS+lane;
  if(k<count){
   var segment=k;
   if(LIST!=LIST_ALL){segment=listedSegment(LIST,k);}
   hairRasterSegment(segment);
  }
 }
}
// A segment's ribbon drawn by this thread or, large, left to the group that follows.
fn hairRasterSegment(segment:u32){
 let ribbon=ribbonOf(segment);
 if(!ribbon.ok){return;}
 let box=ribbonBox(ribbon.corners);
 // A band skips the ribbons that reach none of its rows, before any triangle is set up.
 if(floor(box.w)<f32(band.first)||floor(box.y)>=f32(band.end)){return;}
 // A ribbon of more than a tile of pixels in the band is listed for a group of threads; one the list has no room for stays here.
 let columns=max(min(box.z,view.size.x)-max(box.x,0.0),0.0);
 let rows=max(min(box.w,f32(band.end))-max(box.y,f32(band.first)),0.0);
 if(columns*rows>INLINE_PIXELS){
  let slot=atomicAdd(&large[0],1u);
  if(slot<LARGE_CAPACITY){
   atomicStore(&large[1u+slot],segment);
   return;
  }
 }
 drawRibbon(ribbon,vec2u(0u),vec2u(1u));
}
// One workgroup a listed ribbon: its threads share the ribbon's pixels.
@compute @workgroup_size(${HAIR_LARGE_LANES[0]},${HAIR_LARGE_LANES[1]}) fn hairRasterLarge(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let ribbon=ribbonOf(atomicLoad(&large[1u+block.x]));
 if(!ribbon.ok){return;}
 drawRibbon(ribbon,lane.xy,vec2u(${HAIR_LARGE_LANES[0]}u,${HAIR_LARGE_LANES[1]}u));
}
// The dispatch over the listed ribbons, then the list emptied for the next dispatch.
@compute @workgroup_size(1) fn hairLargeArgs(){
 largeArgs[0]=min(atomicLoad(&large[0]),LARGE_CAPACITY);
 largeArgs[1]=1u;
 largeArgs[2]=1u;
 atomicStore(&large[0],0u);
}`

/**
 * THE VISIBILITY RASTER: every segment of every strand drawn as a ribbon (`HAIR_RIBBON_WGSL`) into
 * `SAMPLES` samples a pixel, by a thread a segment. The segment is cut to the view once, at its spine,
 * before any width (`hairSpineClip`): the ribbon faces the camera, so the two corners of a control
 * point share its clip `w` and `z`, and the near plane cuts both long edges of the ribbon at the
 * spine's parameter. The four corners are taken at the cut, on the subpixel grid, and the two
 * triangles are drawn from them: a corner they share is the same number in both. A triangle is set up
 * as the cluster raster sets its own up (`RASTER_SUBPIXEL_WGSL`): the edges exact sums of whole steps
 * of the grid, and a sample exactly on an edge going to the triangle for which it is a top or a left
 * edge. A sample, at the standard position of its count (`HAIR_SAMPLE_OFFSETS`, whole steps of the
 * grid), is covered by a triangle when it lies inside its three edges; the depth there is the
 * triangle's plane's. Each edge is walked one way whichever triangle holds it (`hairEdgeOf`), so that
 * the two triangles of a ribbon, which share an edge, never both cover a sample on it nor both miss
 * it. A covered sample behind the opaque depth (strictly farther) is dropped. A band takes the ribbons
 * that reach its rows alone; a thread walks the rows its triangle spans, and the pixels each row
 * spans, as the hardware rasterizer walks a triangle: its work follows the triangle's area.
 *
 * THE WORK OF A THREAD IS BOUNDED, as the reference's compute raster bounds it: a segment spanning
 * more than a tile of pixels (`HAIR_INLINE_PIXELS`) is not drawn by its thread but listed (`large`), and
 * the group that follows (`hairRasterLarge`, one workgroup a listed ribbon, over the arguments
 * `hairLargeArgs` wrote from the count, which it also empties) shares it: each thread takes every x-th
 * pixel of every y-th row of its triangles, the strided walk the reference's threads of a segment make
 * (`HAIR_LARGE_LANES`). A ribbon the list has no room for is drawn by its own thread.
 *
 * A sample keeps the nearest strand written to it, and between strands at exactly that depth the
 * greatest identifier (a control point on the low 24 bits, the group's material on the high eight):
 * the 64-bit maximum of (depth, identifier) the visibility write takes (`visWriteWgsl`), by
 * `atomicStoreMax` where the device has it, else in two dispatches over all the strands. The depth is
 * the float's bits, which grow with the depth for a positive float; a sample that holds none has a
 * depth of zero.
 */
export const rasterWgsl = (samples: HairSampleCount, wide: boolean) =>
  rasterModule(samples, wide, RASTER_KERNELS_TEXT)

/** The module of the raster over `samples` samples a pixel: its bindings, the fill of a triangle, the ribbons of the segments, then `kernels`
 *  (the compute raster's other entries, `binnedWgsl.ts`, share all of it). */
export function rasterModule(samples: HairSampleCount, wide: boolean, kernels: string) {
  const step = SUBPIXEL_SAMPLES / HAIR_SAMPLE_OFFSET_STEPS
  const offsets = HAIR_SAMPLE_OFFSETS[samples].map(
    ([x, y]) => `vec2f(${wgslF32(x * step)},${wgslF32(y * step)})`,
  )
  return wgslProgram(
    `${rasterBindingsText(samples, wide, offsets)}\n${LARGE_BINDINGS_TEXT}\n${RASTER_EDGES_TEXT}\n${RASTER_FILL_TEXT}\n${RASTER_RIBBON_TEXT}\n${kernels}`,
    [
      HAIR_RIBBON_WGSL,
      HAIR_BAND_WGSL,
      rasterViewport,
      RASTER_SUBPIXEL_WGSL,
      edgeFunction,
      hairSpineClip,
      visWriteWgsl(wide, { buffer: 'samples', plane: samplePlane }),
      WORKGROUP_THREADS_WGSL,
      FLAT_INDEX_WGSL,
    ],
  )
}

/**
 * THE CLEAR OF THE SAMPLES, over the tiles that hold strands alone: the compaction reads no other, so
 * the buffer is emptied where it will be read and the work follows the area of the strands, not the
 * image's. A group is a tile, one thread a pixel, the tile named by its rank in the list of all the
 * tiles with strands.
 */
export function clearWgsl(samples: HairSampleCount, wide: boolean) {
  return wgslProgram(
    `const SAMPLES=${samples}u;
@group(0) @binding(1) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(2) var<storage,read> tiles:array<u32>;
@group(0) @binding(3) var<storage,read_write> samples:${wide ? 'array<vec2u>' : 'array<u32>'};
@group(0) @binding(4) var<uniform> band:HairBand;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairClearSamples(@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u){
 let at=hairListedPixel(flatIndex(block,blocks,1u),local.xy);
 let pixel=at.pixel;
 if(!at.ok||pixel.y<band.first||pixel.y>=band.end){return;}
 let base=((pixel.y-band.first)*image.size.x+pixel.x)*SAMPLES;
 for(var s=0u;s<SAMPLES;s++){
${wide ? '  samples[base+s]=vec2u(0u);' : '  samples[base+s]=0u;\n  samples[band.plane+base+s]=0u;'}
 }
}`,
    [HAIR_IMAGE_WGSL, HAIR_BAND_WGSL, hairListedPixel, FLAT_INDEX_WGSL],
  )
}
