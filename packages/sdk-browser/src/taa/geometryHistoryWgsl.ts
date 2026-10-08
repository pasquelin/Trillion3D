import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { FLOAT32_STEP } from '../../../math/src/constants.ts'
import { RANGE_BOUND } from '../../../math/src/wgsl/constants.ts'
/** Geometry retained with every display pixel: full placement identity and reversed depth.
 * Four taps bound the slope represented by the historical pixel footprint; `slack`, the current
 * surface's own depth step across one render texel (`closestSurface`), widens it: a frame drawn
 * below the display gives neighbouring display pixels one render texel, so their four taps can
 * hold one depth while the jitter moves the sampled point across that texel — without it a static
 * sloped floor read as uncovered on half its pixels each frame and kept no history. Identity alone
 * cannot detect a surface revealing another part of the same mesh. The identity is the page's
 * (`pageOf`, `historyWgsl.ts`). */
export const GEOMETRY_HISTORY_WGSL = wgslBlock(
  'GEOMETRY_HISTORY_WGSL',
  [RANGE_BOUND],
  `
fn geometryDepthAccepts(expected:f32,low:f32,high:f32)->bool{
 let rounding=${wgslF32(4 * FLOAT32_STEP)}*max(abs(expected),max(abs(low),abs(high)));
 let reach=(high-low)+rounding;
 return expected>=low-reach&&expected<=high+reach;
}
fn geometryTap(range:vec2f,kept:u32,bits:u32,identity:u32)->vec2f{
 if(kept!=identity){return range;}
 let z=bitcast<f32>(bits);return vec2f(min(range.x,z),max(range.y,z));
}
fn geometryUncovered(uv:vec2f,expected:f32,identity:u32,slack:f32)->bool{
 let size=vec2f(textureDimensions(geometryHistory));
 let corner=(floor(uv*size-0.5)+1.0)/size;
 let kept=textureGather(0,geometryHistory,texelSampler,corner);
 let bits=textureGather(1,geometryHistory,texelSampler,corner);
 var range=geometryTap(vec2f(RANGE_BOUND,-RANGE_BOUND),kept.w,bits.w,identity);
 range=geometryTap(range,kept.z,bits.z,identity);
 range=geometryTap(range,kept.x,bits.x,identity);
 range=geometryTap(range,kept.y,bits.y,identity);
 return range.y<range.x||!geometryDepthAccepts(expected,range.x-slack,range.y+slack);
}`,
)

/** The nearest of the 3×3 depths `above`, `middle` and `below`, the identifier of its texel among
 *  `aboveIds`, `middleIds` and `belowIds`, and the surface's depth step (`CLOSEST_SURFACE_WGSL`). */
const NEAREST_OF_WGSL = wgslBlock(
  'NEAREST_OF_WGSL',
  [],
  `
struct TaaNearest{depth:f32,slope:f32,id:u32}
fn nearestOf(above:vec3f,middle:vec3f,below:vec3f,aboveIds:vec3u,middleIds:vec3u,belowIds:vec3u)->TaaNearest{
 let centre=middle.y;
 var nearDepth=centre;var nearId=middleIds.y;
 for(var dy=-1;dy<=1;dy++){
  var row=middle;var rowIds=middleIds;if(dy<0){row=above;rowIds=aboveIds;}if(dy>0){row=below;rowIds=belowIds;}
  for(var dx=-1;dx<=1;dx++){
   let z=row[dx+1];
   if(z>nearDepth){nearDepth=z;nearId=rowIds[dx+1];}
  }
 }
 let west=middle.x;let east=middle.z;let north=above.y;let south=below.y;
 let slope=max(min(abs(west-centre),abs(east-centre)),min(abs(north-centre),abs(south-centre)));
 return TaaNearest(nearDepth,slope,nearId);
}`,
)

/** Same closest-surface selection for native and reconstructed display pixels. Reversed depth
 * makes the largest depth the foreground; its identity and motion travel together: the identifier
 * of its texel, which the pixel's page record and motion are read by. `slope` is the surface's
 * depth step across one texel, a measure of its depth error: per axis the smaller of the two
 * one-sided differences around the centre, so a silhouette on one side does not count, the larger
 * of both axes.
 *
 * The 3×3 depths come in four gathers, not nine loads, and their identifiers in four more, taken
 * with them: the nearest's identifier waits on no read of its own. Each gathers the 2×2 whose
 * shared corner it is taken at — exactly, half a texel from any other footprint. The right and
 * lower ones are taken at most at `last`, so every tap is clamped to the drawn image as
 * `clamp(coord+d,0,last)` would (the targets may be allocated larger, `drawFrameAt`), the upper
 * left ones by the sampler's edge.
 * Lanes (WGSL `textureGather`): x the lower left, y the lower right, z the upper right, w the upper
 * left. The strict `>` keeps the first nearest in the same row-major order; the centre, compared
 * with itself, never passes it (`nearestOf`). */
export const CLOSEST_SURFACE_WGSL = wgslBlock(
  'CLOSEST_SURFACE_WGSL',
  [NEAREST_OF_WGSL],
  `
fn closestSurface(coord:vec2i,last:vec2i)->TaaNearest{
 let size=vec2f(textureDimensions(depth));
 let after=min(coord+vec2i(1),last);
 let lo=vec2f(coord)/size;let hi=vec2f(after)/size;
 let upLeft=textureGather(depth,texelSampler,lo);
 let upRight=textureGather(depth,texelSampler,vec2f(hi.x,lo.y));
 let downLeft=textureGather(depth,texelSampler,vec2f(lo.x,hi.y));
 let downRight=textureGather(depth,texelSampler,hi);
 let idSize=vec2f(textureDimensions(ids));
 let idLo=vec2f(coord)/idSize;let idHi=vec2f(after)/idSize;
 let idUpLeft=textureGather(0,ids,texelSampler,idLo);
 let idUpRight=textureGather(0,ids,texelSampler,vec2f(idHi.x,idLo.y));
 let idDownLeft=textureGather(0,ids,texelSampler,vec2f(idLo.x,idHi.y));
 let idDownRight=textureGather(0,ids,texelSampler,idHi);
 let above=vec3f(upLeft.w,upLeft.z,upRight.z);let middle=vec3f(upLeft.x,upLeft.y,upRight.y);
 let below=vec3f(downLeft.x,downLeft.y,downRight.y);
 let aboveIds=vec3u(idUpLeft.w,idUpLeft.z,idUpRight.z);let middleIds=vec3u(idUpLeft.x,idUpLeft.y,idUpRight.y);
 let belowIds=vec3u(idDownLeft.x,idDownLeft.y,idDownRight.y);
 return nearestOf(above,middle,below,aboveIds,middleIds,belowIds);
}`,
)
