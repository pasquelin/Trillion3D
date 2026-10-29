/**
 * THE ATLAS'S PASSES, in WGSL. The vertex stage is the one every pass draws its rectangles with: an instance a slot, two triangles over the
 * slot's rectangle of the target level, the picture's coordinate and the coordinate in the slot handed on. The pixel stages: the picture drawn
 * into the atlas (`ADD_WGSL`), a slot moved from the old atlas to the new one a level at a time (`COPY_WGSL`), and a level filtered from
 * the one above (`FILTER_WGSL`, a box of 2 by 2 texels or a Gaussian approximation). The debug clear fills a texel the slots do not
 * cover with magenta (`CLEAR_WGSL`).
 */

/** The vertex stage: group 0 holds the slots (`x`, `y`, width, height in texels), the picture's share and offset for each, and the pass's figures. */
const RECT_VERTEX = `
struct PassFigures{atlas:vec2f,hasScaleOffset:u32,mipBias:i32,mip:u32,quality:u32,srcAtlas:vec2f,}
@group(0) @binding(0) var<storage,read> slots:array<vec4u>;
@group(0) @binding(1) var<storage,read> scaleOffsets:array<vec4f>;
@group(0) @binding(2) var<uniform> figures:PassFigures;
struct RectOut{@builtin(position) position:vec4f,@location(0) coord:vec2f,@location(1) uv:vec2f,@location(2) @interpolate(flat) id:u32,}
@vertex fn mainVs(@builtin(vertex_index) v:u32,@builtin(instance_index) id:u32)->RectOut{
 let rect=slots[id];
 var scaleOffset=vec4f(1.0,1.0,0.0,0.0);
 if(figures.hasScaleOffset!=0u){scaleOffset=scaleOffsets[id];}
 // The rectangle's corner of this vertex: two triangles, (0,0) (1,0) (1,1) and (0,0) (1,1) (0,1).
 let src=vec2f(select(0.0,1.0,v==1u||v==2u||v==4u),select(0.0,1.0,v==2u||v==4u||v==5u));
 let size=vec2f(rect.zw);
 let dst=src*size/figures.atlas+vec2f(rect.xy)/figures.atlas;
 return RectOut(vec4f(dst*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.5,1.0),src*size,src*scaleOffset.xy+scaleOffset.zw,id);
}`

/** The picture of a slot drawn into the atlas: group 1 holds the picture and its sampler; a NaN or a negative texel is 0. */
export const ADD_WGSL = `${RECT_VERTEX}
@group(1) @binding(0) var picture:texture_2d<f32>;
@group(1) @binding(1) var pictureSampler:sampler;
@fragment fn mainPs(in:RectOut)->@location(0) vec4f{
 let c=textureSampleLevel(picture,pictureSampler,in.uv,f32(figures.mipBias));
 return select(vec4f(0.0),c,c>=vec4f(0.0));
}`

/** A level of a slot moved from the old atlas: group 1 holds the source slots (their origin in the level read) and the old atlas. */
export const COPY_WGSL = `${RECT_VERTEX}
@group(1) @binding(0) var<storage,read> sourceSlots:array<vec4u>;
@group(1) @binding(1) var sourceAtlas:texture_2d<f32>;
@fragment fn mainPs(in:RectOut)->@location(0) vec4f{
 let at=vec2u(in.coord)+sourceSlots[in.id].xy;
 return textureLoad(sourceAtlas,vec2i(at),i32(figures.mip));
}`

/** A level filtered from the one above it, a slot's texel from the 2 by 2 texels over it (quality 0), or from the thirteen taps of a Gaussian
 *  approximation (quality 1); group 1 holds the source slots, the level read (a view of that level alone) and its sampler. */
export const FILTER_WGSL = `${RECT_VERTEX}
@group(1) @binding(0) var<storage,read> sourceSlots:array<vec4u>;
@group(1) @binding(1) var sourceLevel:texture_2d<f32>;
@group(1) @binding(2) var sourceSampler:sampler;
fn filterTap(weight:f32,coord:vec2f,low:vec2f,high:vec2f)->vec3f{
 let at=clamp(coord,low+0.5,high-0.5);
 return weight*textureSampleLevel(sourceLevel,sourceSampler,at/figures.srcAtlas,0.0).xyz;
}
fn boxFilter(in:RectOut)->vec4f{
 let src=sourceSlots[in.id];
 let own=vec2f(vec2u(in.coord)*2u);
 let origin=vec2f(src.xy);
 let end=origin+vec2f(src.zw);
 var sum=vec4f(0.0);var count=0.0;
 for(var k=0u;k<4u;k++){
  let at=origin+own+vec2f(f32(k&1u),f32(k>>1u));
  if(all(at<end)){sum+=textureLoad(sourceLevel,vec2i(at),0);count+=1.0;}
 }
 return sum/max(1.0,count);
}
fn gaussianFilter(in:RectOut)->vec4f{
 let src=sourceSlots[in.id];
 // The coordinate is a texel's centre: the centre of the 2 by 2 block of the level above.
 let c=vec2f(src.xy)+in.coord*2.0;
 let low=vec2f(src.xy);let high=low+vec2f(src.zw);
 var m=filterTap(0.125,c,low,high);
 m+=filterTap(0.125,c+vec2f(1.0,1.0),low,high)+filterTap(0.125,c+vec2f(-1.0,1.0),low,high)
  +filterTap(0.125,c+vec2f(-1.0,-1.0),low,high)+filterTap(0.125,c+vec2f(1.0,-1.0),low,high);
 m+=filterTap(0.0625,c+vec2f(2.0,0.0),low,high)+filterTap(0.0625,c+vec2f(-2.0,0.0),low,high)
  +filterTap(0.0625,c+vec2f(0.0,2.0),low,high)+filterTap(0.0625,c+vec2f(0.0,-2.0),low,high);
 m+=filterTap(0.03125,c+vec2f(2.0,2.0),low,high)+filterTap(0.03125,c+vec2f(-2.0,2.0),low,high)
  +filterTap(0.03125,c+vec2f(-2.0,-2.0),low,high)+filterTap(0.03125,c+vec2f(2.0,-2.0),low,high);
 return vec4f(m,1.0);
}
@fragment fn mainPs(in:RectOut)->@location(0) vec4f{
 if(figures.quality==0u){return boxFilter(in);}
 return gaussianFilter(in);
}`

/** The debug clear: a texel of the level is magenta. */
export const CLEAR_WGSL = `
struct ClearFigures{size:vec2u,}
@group(0) @binding(0) var<uniform> clearFigures:ClearFigures;
@group(0) @binding(1) var level:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8,1) fn mainCs(@builtin(global_invocation_id) id:vec3u){
 if(all(id.xy<clearFigures.size)){textureStore(level,id.xy,vec4f(1.0,0.0,1.0,1.0));}
}`
