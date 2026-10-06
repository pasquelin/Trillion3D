/** Geometry retained with every display pixel: full placement identity and reversed depth.
 * Four taps bound the slope represented by the historical pixel footprint; `slack`, the current
 * surface's own depth step across one render texel (`closestSurface`), widens it: a frame drawn
 * below the display gives neighbouring display pixels one render texel, so their four taps can
 * hold one depth while the jitter moves the sampled point across that texel — without it a static
 * sloped floor read as uncovered on half its pixels each frame and kept no history. Identity alone
 * cannot detect a surface revealing another part of the same mesh. The identity is the page's
 * (`pageOf`, `historyWgsl.ts`). */
export const GEOMETRY_HISTORY_WGSL = `
fn geometryDepthAccepts(expected:f32,low:f32,high:f32)->bool{
 let rounding=4.0*1.1920928955078125e-7*max(abs(expected),max(abs(low),abs(high)));
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
 var range=geometryTap(vec2f(1e9,-1e9),kept.w,bits.w,identity);
 range=geometryTap(range,kept.z,bits.z,identity);
 range=geometryTap(range,kept.x,bits.x,identity);
 range=geometryTap(range,kept.y,bits.y,identity);
 return range.y<range.x||!geometryDepthAccepts(expected,range.x-slack,range.y+slack);
}`

/** Same closest-surface selection for native and reconstructed display pixels. Reversed depth
 * makes the largest depth the foreground; its identity and motion travel together. `w` is the
 * surface's depth step across one texel, a measure of its depth error: per axis the smaller of
 * the two one-sided differences around the centre, so a silhouette on one side does not count,
 * the larger of both axes.
 *
 * The 3×3 depths come in four gathers, not nine loads: each gathers the 2×2 whose shared corner it
 * is taken at — exactly, half a texel from any other footprint. The right and lower ones are taken
 * at most at `last`, so every tap is clamped to the drawn image as `clamp(coord+d,0,last)` would
 * (the targets may be allocated larger, `drawFrameAt`), the upper left ones by the sampler's edge.
 * Lanes (WGSL `textureGather`): x the lower left, y the lower right, z the upper right, w the upper
 * left. The strict `>` keeps the first nearest in the same row-major order; the centre, compared
 * with itself, never passes it (`nearestOf`). */
export const closestSurfaceWgsl = `
fn closestSurface(coord:vec2i,last:vec2i)->vec4f{
 let size=vec2f(textureDimensions(depth));
 let after=min(coord+vec2i(1),last);
 let lo=vec2f(coord)/size;let hi=vec2f(after)/size;
 let upLeft=textureGather(depth,texelSampler,lo);
 let upRight=textureGather(depth,texelSampler,vec2f(hi.x,lo.y));
 let downLeft=textureGather(depth,texelSampler,vec2f(lo.x,hi.y));
 let downRight=textureGather(depth,texelSampler,hi);
 let above=vec3f(upLeft.w,upLeft.z,upRight.z);let middle=vec3f(upLeft.x,upLeft.y,upRight.y);
 let below=vec3f(downLeft.x,downLeft.y,downRight.y);
 return nearestOf(coord,last,above,middle,below);
}`

/** The nearest of the 3×3 depths `above`, `middle` and `below` around `coord`, and the surface's
 *  depth step (`closestSurfaceWgsl`). */
export const NEAREST_OF_WGSL = `
fn nearestOf(coord:vec2i,last:vec2i,above:vec3f,middle:vec3f,below:vec3f)->vec4f{
 let centre=middle.y;
 var near=coord;var nearDepth=centre;
 for(var dy=-1;dy<=1;dy++){
  var row=middle;if(dy<0){row=above;}if(dy>0){row=below;}
  for(var dx=-1;dx<=1;dx++){
   let z=row[dx+1];
   if(z>nearDepth){nearDepth=z;near=clamp(coord+vec2i(dx,dy),vec2i(0),last);}
  }
 }
 let west=middle.x;let east=middle.z;let north=above.y;let south=below.y;
 let slope=max(min(abs(west-centre),abs(east-centre)),min(abs(north-centre),abs(south-centre)));
 return vec4f(vec2f(near),nearDepth,slope);
}`
