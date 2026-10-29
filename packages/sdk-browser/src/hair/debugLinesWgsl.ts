import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { HAIR_AABB_PRECISION_SCALE } from './boundsWgsl.ts'
import { DEBUG_CPU_LINES, DEBUG_COLORS } from './debugLines.ts'
import { HAIR_DEEP_SHADOW_MAX_SLOTS } from './deepShadowMath.ts'
import { MAX_MACRO_GROUPS } from './macroGroups.ts'

/** The lines the GPU writes: twelve edges for each deep shadow's frustum, then each macro group's box, then each voxel node's box,
 *  after the host's lines. */
const EDGES = 12
export const DEBUG_GPU_LINES = {
  frusta: DEBUG_CPU_LINES,
  macro: DEBUG_CPU_LINES + HAIR_DEEP_SHADOW_MAX_SLOTS * EDGES,
  nodes: DEBUG_CPU_LINES + (HAIR_DEEP_SHADOW_MAX_SLOTS + MAX_MACRO_GROUPS) * EDGES,
  end: DEBUG_CPU_LINES + (HAIR_DEEP_SHADOW_MAX_SLOTS + 2 * MAX_MACRO_GROUPS) * EDGES,
} as const
/** The words of the viewer's uniform: the view-projection, the display's size, the width of a line in pixels, which lines the pass draws (`DEBUG_LINE_KIND`). */
export const DEBUG_VIEW_FLOATS = 20

/** The space of a line: the world relative to the eye, the display's pixels, or the world with the opaque depth test (the line is drawn only where no surface is nearer the eye). */
export const DEBUG_LINE_SPACE = { world: 0, pixels: 1, worldDepthTested: 2 } as const
/** The lines a pass draws, by the view's `kind` word: the opaque ones, the translucent ones (a colour of less than full alpha, which the pass lays over the others), the depth tested ones. */
export const DEBUG_LINE_KIND = { opaque: 0, translucent: 1, depthTested: 2 } as const

/** A line: its first end, its colour (the bytes of a word), its second end and its space (`DEBUG_LINE_SPACE`). A line of the display's pixels may
 *  carry its own width in the third number of its first end (a quad filled is one line along its middle as wide as the quad); none, zero, takes the view's. */
export const DEBUG_LINE_STRUCT = 'struct DebugLine{a:vec3f,color:u32,b:vec3f,space:f32}'
const LINE = DEBUG_LINE_STRUCT

/**
 * THE LINES DRAWN OVER THE IMAGE: every line of the buffer is a quad of the width in pixels the view says, between its ends
 * seen through the view-projection or taken as pixels; a world end behind the camera is brought to the near plane and a line
 * of no length is not drawn (the lines the GPU has not written stay zero).
 */
export const DEBUG_LINES_DRAW_WGSL = wgslProgram(
  `${LINE}
struct DebugView{viewProj:mat4x4f,size:vec2f,width:f32,kind:f32}
@group(0) @binding(0) var<uniform> view:DebugView;
@group(0) @binding(1) var<storage,read> lines:array<DebugLine>;
@group(0) @binding(2) var sceneDepth:texture_depth_2d;
struct Out{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) @interpolate(linear) depth:f32}
const NEAR_W=0.0001;
@vertex fn debugLineVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) index:u32)->Out{
 let line=lines[index];
 var out:Out;
 out.position=vec4f(2.0,2.0,2.0,1.0);
 out.color=unpack4x8unorm(line.color);
 // A pass draws one kind of line (the view's): the translucent after the opaque, so a mark is never tinted by a fill laid over it.
 let kind=select(select(${DEBUG_LINE_KIND.opaque}.0,${DEBUG_LINE_KIND.translucent}.0,out.color.a<1.0),${DEBUG_LINE_KIND.depthTested}.0,line.space>1.5);
 if(kind!=view.kind){return out;}
 var pa=line.a.xy;
 var pb=line.b.xy;
 var za=0.0;
 var zb=0.0;
 if(line.space!=${DEBUG_LINE_SPACE.pixels}.0){
  var ha=view.viewProj*vec4f(line.a,1.0);
  var hb=view.viewProj*vec4f(line.b,1.0);
  if(ha.w<=NEAR_W&&hb.w<=NEAR_W){return out;}
  if(ha.w<=NEAR_W){ha=mix(ha,hb,(NEAR_W-ha.w)/(hb.w-ha.w));}
  if(hb.w<=NEAR_W){hb=mix(hb,ha,(NEAR_W-hb.w)/(ha.w-hb.w));}
  pa=(ha.xy/ha.w*vec2f(0.5,-0.5)+vec2f(0.5))*view.size;
  pb=(hb.xy/hb.w*vec2f(0.5,-0.5)+vec2f(0.5))*view.size;
  za=ha.z/ha.w;
  zb=hb.z/hb.w;
 }
 let d=pb-pa;
 let span=length(d);
 if(!(span>0.0001)){return out;}
 let along=d/span;
 // The quad's corners: the end of the line (0 first, 1 second) and the side (-1 or 1).
 let corner=vec2f(f32(vertex==2u||vertex==3u||vertex==5u),select(-1.0,1.0,vertex==1u||vertex==4u||vertex==5u));
 let width=select(view.width,line.a.z,line.space==${DEBUG_LINE_SPACE.pixels}.0&&line.a.z>0.0);
 let p=mix(pa,pb,corner.x)+vec2f(-along.y,along.x)*corner.y*0.5*width;
 out.position=vec4f(p/view.size*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0);
 out.depth=mix(za,zb,corner.x);
 return out;
}
@fragment fn debugLineFs(in:Out)->@location(0) vec4f{return in.color;}
// The depth tested lines keep a pixel only where no surface of the opaque depth is nearer the eye (the depth runs 1 at the near plane to 0 at infinity).
@fragment fn debugLineDepthFs(in:Out)->@location(0) vec4f{
 let at=vec2i(in.position.xy*vec2f(textureDimensions(sceneDepth))/view.size);
 if(in.depth<textureLoad(sceneDepth,at,0)){discard;}
 return in.color;
}`,
  [],
)

/** The inverse of a matrix, by Gauss-Jordan elimination with a pivot. */
const inverse4 = wgslFn(
  'debugInverse4',
  [],
  `fn debugInverse4(m:mat4x4f)->mat4x4f{
 var r=array<vec4f,4>(vec4f(m[0][0],m[1][0],m[2][0],m[3][0]),vec4f(m[0][1],m[1][1],m[2][1],m[3][1]),vec4f(m[0][2],m[1][2],m[2][2],m[3][2]),vec4f(m[0][3],m[1][3],m[2][3],m[3][3]));
 var e=array<vec4f,4>(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(0.0,0.0,0.0,1.0));
 for(var c=0u;c<4u;c++){
  var pivot=c;
  for(var k=c+1u;k<4u;k++){if(abs(r[k][c])>abs(r[pivot][c])){pivot=k;}}
  let swapR=r[c];r[c]=r[pivot];r[pivot]=swapR;
  let swapE=e[c];e[c]=e[pivot];e[pivot]=swapE;
  let scale=1.0/r[c][c];
  r[c]=r[c]*scale;e[c]=e[c]*scale;
  for(var k=0u;k<4u;k++){
   if(k!=c){let f=r[k][c];r[k]=r[k]-f*r[c];e[k]=e[k]-f*e[c];}
  }
 }
 return mat4x4f(vec4f(e[0].x,e[1].x,e[2].x,e[3].x),vec4f(e[0].y,e[1].y,e[2].y,e[3].y),vec4f(e[0].z,e[1].z,e[2].z,e[3].z),vec4f(e[0].w,e[1].w,e[2].w,e[3].w));
}`,
)

/** Writes the twelve edges of the box whose corners are `c` from the line `first`, in the colour `color`. */
const putBox = wgslFn(
  'debugPutBox',
  [],
  `fn debugPutBox(first:u32,c:array<vec3f,8>,color:u32){
 let edges=array<vec2u,12>(vec2u(0u,1u),vec2u(2u,3u),vec2u(4u,5u),vec2u(6u,7u),vec2u(0u,2u),vec2u(1u,3u),vec2u(4u,6u),vec2u(5u,7u),vec2u(0u,4u),vec2u(1u,5u),vec2u(2u,6u),vec2u(3u,7u));
 for(var k=0u;k<12u;k++){lines[first+k]=DebugLine(c[edges[k].x],color,c[edges[k].y],0.0);}
}`,
)

/** The corners of the box between `lo` and `hi`, in the order of the host's edges. */
const boxCorners = wgslFn(
  'debugBoxCorners',
  [],
  `fn debugBoxCorners(lo:vec3f,hi:vec3f)->array<vec3f,8>{
 return array<vec3f,8>(lo,vec3f(hi.x,lo.y,lo.z),vec3f(lo.x,hi.y,lo.z),vec3f(hi.x,hi.y,lo.z),vec3f(lo.x,lo.y,hi.z),vec3f(hi.x,lo.y,hi.z),vec3f(lo.x,hi.y,hi.z),hi);
}`,
)

const rgba = (color: number) => `${color}u`

/**
 * THE LINES THE GPU WRITES, each kernel a thread for one box, into its own lines of the buffer (`DEBUG_GPU_LINES`), which the host
 * has emptied: `debugFrusta` the frustum of each deep shadow's slot (the clip box between depths 0 and 1 of the slot's view-projection,
 * carried back to the world), `debugMacroBoxes` the box of each macro group, `debugNodeBoxes` the box of each voxel node that holds pages.
 * `count` is how many slots, groups or nodes there are.
 */
export const DEBUG_LINES_GPU_WGSL = wgslProgram(
  `${LINE}
struct DeepViewInfo{toClipScaledBiased:mat4x4f,toClip:mat4x4f,atlasScaleBias:vec4f,viewForward:vec3f,minRadius:f32}
@group(0) @binding(0) var<uniform> count:vec4u;
@group(0) @binding(1) var<storage,read_write> lines:array<DebugLine>;
@group(0) @binding(2) var<storage,read> viewInfos:array<DeepViewInfo>;
@group(0) @binding(3) var<storage,read> macroAabb:array<i32>;
@group(0) @binding(4) var<storage,read> nodes:array<u32>;
@compute @workgroup_size(${HAIR_DEEP_SHADOW_MAX_SLOTS}) fn debugFrusta(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=count.x){return;}
 let back=debugInverse4(viewInfos[id.x].toClip);
 var c:array<vec3f,8>;
 for(var k=0u;k<8u;k++){
  let h=back*vec4f(select(-1.0,1.0,(k&1u)!=0u),select(-1.0,1.0,(k&2u)!=0u),select(0.0,1.0,(k&4u)!=0u),1.0);
  c[k]=h.xyz/h.w;
 }
 debugPutBox(${DEBUG_GPU_LINES.frusta}u+id.x*12u,c,${rgba(DEBUG_COLORS.frustum)});
}
@compute @workgroup_size(${MAX_MACRO_GROUPS}) fn debugMacroBoxes(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=count.x){return;}
 let at=id.x*6u;
 let lo=vec3f(f32(macroAabb[at]),f32(macroAabb[at+1u]),f32(macroAabb[at+2u]))/${HAIR_AABB_PRECISION_SCALE}.0;
 let hi=vec3f(f32(macroAabb[at+3u]),f32(macroAabb[at+4u]),f32(macroAabb[at+5u]))/${HAIR_AABB_PRECISION_SCALE}.0;
 debugPutBox(${DEBUG_GPU_LINES.macro}u+id.x*12u,debugBoxCorners(lo,hi),${rgba(DEBUG_COLORS.lightRed)});
}
@compute @workgroup_size(${MAX_MACRO_GROUPS}) fn debugNodeBoxes(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=count.x){return;}
 let at=id.x*8u;
 if((nodes[at+3u]&0xFFFFFFu)==0u){return;}
 let lo=vec3f(bitcast<f32>(nodes[at]),bitcast<f32>(nodes[at+1u]),bitcast<f32>(nodes[at+2u]));
 let hi=vec3f(bitcast<f32>(nodes[at+4u]),bitcast<f32>(nodes[at+5u]),bitcast<f32>(nodes[at+6u]));
 debugPutBox(${DEBUG_GPU_LINES.nodes}u+id.x*12u,debugBoxCorners(lo,hi),${rgba(DEBUG_COLORS.orange)});
}`,
  [inverse4, putBox, boxCorners],
)
