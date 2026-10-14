import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { bitMask, bitWord } from '../../../../math/src/wgsl/integer.ts'
import {
  VIS_MAX_PAGE_TRIANGLES,
  VIS_TRIANGLE_BITS,
  visPageIndex,
  visTriangle,
} from '../visWords.ts'
import {
  FLAT_INDEX_WGSL,
  OPEN_SLICE_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL, PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'
import { PIXEL_TRIANGLE_WGSL, SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { CACHE_READ_WGSL, MARK_TILE, ROW_FRAME_WGSL } from './shadeCacheLayout.ts'

/** THE RESOLVE'S FRAME CACHE'S PASSES (`shadeCacheLayout.ts`): the marks and rows passes, then the
 *  triangles pass. */

/** The marks and rows passes, on the cache's words as atomics; \`work\`, the triangles pass's
 *  dispatch, x then y. */
export const SHADE_CACHE_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(1) var<storage,read_write> shadeCache:array<atomic<u32>>;
@group(0) @binding(2) var vis:texture_2d<u32>;
@group(0) @binding(3) var<storage,read_write> work:array<atomic<u32>,3>;
fn storeWord(at:u32,v:u32){atomicStore(&shadeCache[at],v);}
fn storeVec3(at:u32,v:vec3f){let b=bitcast<vec3u>(v);storeWord(at,b.x);storeWord(at+1u,b.y);storeWord(at+2u,b.z);}
fn storeRowFrame(at:u32,f:RowFrame){
 storeVec3(at,f.invT.adj[0]);storeVec3(at+3u,f.invT.adj[1]);storeVec3(at+6u,f.invT.adj[2]);
 storeWord(at+9u,bitcast<u32>(f.invT.scale));storeWord(at+10u,select(0u,1u,f.invT.regular));storeWord(at+11u,select(0u,1u,f.positive));
}
/** What a pixel proves of its triangle from its tile's neighbours: 2 a second read — its left
 *  neighbour holds it but not the one before, or only the upper one does —, 1 a run met nowhere
 *  above, 0 nothing new. \`left\`, \`leftLeft\`, \`up\` are zero off the tile, never an identifier. */
fn markKind(id:u32,left:u32,leftLeft:u32,up:u32)->u32{
 if(id==left){return select(0u,2u,leftLeft!=id);}
 return select(1u,2u,id==up);
}
fn markTriangle(rows:u32,row:u32,tri:u32,kind:u32){
 let at=rowMarks(rows,row)+bitWord(tri);let bit=bitMask(tri);
 if(kind==0u||(atomicLoad(&shadeCache[at+PLANE_WORDS])&bit)!=0u){return;}
 if(kind==2u||(atomicOr(&shadeCache[at],bit)&bit)!=0u){atomicOr(&shadeCache[at+PLANE_WORDS],bit);}
}
/** What the marks and rows passes count from zero — every row's marks, the slots' cursor and the
 *  end of the fitting ones, and the triangles pass's dispatch, x and y — zeroed by the frame's
 *  first dispatch, one lane per mark word. */
@compute @workgroup_size(WORKGROUP_THREADS) fn shade_clear(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,WORKGROUP_THREADS);
 if(i<2u){atomicStore(&work[i],0u);}
 if(i==0u){atomicStore(&shadeCache[SHADE_CACHE_CURSOR],0u);atomicStore(&shadeCache[SHADE_CACHE_END],0u);}
 let rows=atomicLoad(&shadeCache[SHADE_CACHE_ROWS]);
 if(i<rows*ROW_MARK_WORDS){atomicStore(&shadeCache[rowMarks(rows,0u)+i],0u);}
}
var<workgroup> tileIds:array<u32,${MARK_TILE * MARK_TILE}>;
@compute @workgroup_size(${MARK_TILE},${MARK_TILE}) fn shade_marks(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_id) l:vec3u){
 var id=0u;
 if(all(g.xy<textureDimensions(vis))){id=textureLoad(vis,vec2i(g.xy),0).r;}
 let at=l.y*${MARK_TILE}u+l.x;
 tileIds[at]=id;
 workgroupBarrier();
 if(id<${VIS_MAX_PAGE_TRIANGLES}u){return;}
 let rows=atomicLoad(&shadeCache[SHADE_CACHE_ROWS]);
 if((id>>${VIS_TRIANGLE_BITS}u)>rows){return;}
 let left=select(0u,tileIds[at-min(l.x,1u)],l.x>0u);
 let leftLeft=select(0u,tileIds[at-min(l.x,2u)],l.x>1u);
 let up=select(0u,tileIds[at-select(0u,${MARK_TILE}u,l.y>0u)],l.y>0u);
 markTriangle(rows,visPageIndex(id),visTriangle(id),markKind(id,left,leftLeft,up));
}
/**
 * Row \`row\`'s marks, read once: its frame composed when a pixel reads it, then the slots of its
 * B triangles taken with one atomic add, or its B words cleared past the capacity. A row that fits
 * writes each slot's triangle in the slot's first word, raises the end of the fitting slots and
 * the triangles pass's dispatch.
 */
@compute @workgroup_size(WORKGROUP_THREADS) fn shade_rows(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(g,n,WORKGROUP_THREADS);
 let rows=atomicLoad(&shadeCache[SHADE_CACHE_ROWS]);
 if(row>=rows){return;}
 let record=ROW_RECORDS+row*ROW_RECORD_WORDS;
 let marks=rowMarks(rows,row)+PLANE_WORDS;
 var twice:array<u32,PLANE_WORDS>;var count=0u;var seen=0u;var before=vec2u(0u);
 for(var w=0u;w<PLANE_WORDS;w++){
  twice[w]=atomicLoad(&shadeCache[marks+w]);
  seen|=twice[w]|atomicLoad(&shadeCache[marks-PLANE_WORDS+w]);
  before[w>>2u]|=count<<((w&3u)*8u);
  count+=countOneBits(twice[w]);
 }
 if(seen!=0u){storeRowFrame(record,composeRowFrame(pages[row].world));}
 if(count==0u){return;}
 let base=atomicAdd(&shadeCache[SHADE_CACHE_CURSOR],count);
 if(base+count>atomicLoad(&shadeCache[SHADE_CACHE_CAPACITY])){
  for(var w=0u;w<PLANE_WORDS;w++){storeWord(marks+w,0u);}
  return;
 }
 storeWord(record+ROW_BASE,base);storeWord(record+ROW_PREFIX,before.x);storeWord(record+ROW_PREFIX+1u,before.y);
 var slot=base;
 for(var w=0u;w<PLANE_WORDS;w++){
  for(var bits=twice[w];bits!=0u;bits&=bits-1u){
   storeWord(cachedTriangles(rows)+slot*TRIANGLE_WORDS,(row<<${VIS_TRIANGLE_BITS}u)|(w*32u+firstTrailingBit(bits)));
   slot++;
  }
 }
 atomicMax(&shadeCache[SHADE_CACHE_END],base+count);
 openSlice(0u,(base+count-1u)/WORKGROUP_THREADS);
}`,
  [
    PAGE_INFO_STRUCT_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    OPEN_SLICE_WGSL,
    ROW_FRAME_WGSL,
    bitWord,
    bitMask,
    visPageIndex,
    visTriangle,
  ],
)

/** The triangles pass, the page decoded by the resolve's own text. */
export const SHADE_TRIS_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(1) var<storage,read_write> shadeCache:array<u32>;
@group(0) @binding(2) var<storage,read> indices:array<u32>;
@group(0) @binding(3) var<storage,read> positions:array<f32>;
@group(0) @binding(4) var<storage,read> uvs:array<f32>;
@group(0) @binding(5) var<uniform> uni:ShadeUni;
fn storeVec(at:u32,v:vec4f,size:u32){let b=bitcast<vec4u>(v);for(var k=0u;k<size;k++){shadeCache[at+k]=b[k];}}
fn storeTriangle(at:u32,t:PixelTriangle){
 storeVec(at,t.p0,4u);storeVec(at+4u,t.p1,4u);storeVec(at+8u,t.p2,4u);
 storeVec(at+12u,t.w0,4u);storeVec(at+16u,t.w1,4u);storeVec(at+20u,t.w2,4u);
 storeVec(at+24u,vec4f(t.n0,0.0),3u);storeVec(at+27u,vec4f(t.n1,0.0),3u);storeVec(at+30u,vec4f(t.n2,0.0),3u);
 storeVec(at+33u,vec4f(t.uva,0.0,0.0),2u);storeVec(at+35u,vec4f(t.uvb,0.0,0.0),2u);storeVec(at+37u,vec4f(t.uvc,0.0,0.0),2u);
 storeVec(at+39u,vec4f(t.iw,0.0),3u);
}
/** One lane per slot below the end of the fitting slots: the triangle its first word names. */
@compute @workgroup_size(WORKGROUP_THREADS) fn shade_tris(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=flatIndex(g,n,WORKGROUP_THREADS);
 if(slot>=shadeCache[SHADE_CACHE_END]){return;}
 let at=cachedTriangles(shadeCache[SHADE_CACHE_ROWS])+slot*TRIANGLE_WORDS;
 let row=shadeCache[at]>>${VIS_TRIANGLE_BITS}u;let tri=visTriangle(shadeCache[at]);
 let page=pages[row];
 // A triangle past its page is marked, never read: its pixel shades nothing.
 if(tri*3u+2u>=page.indexCount){return;}
 storeTriangle(at,decodeTriangle(page,tri,rowFrame(row,page.world).invT));
}`,
  [
    PAGE_INFO_STRUCT_WGSL,
    SHADE_UNI_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    normalAtlasWgsl(6),
    PAGE_SCREEN_WGSL,
    PAGE_NORMAL_WGSL,
    PAGE_GEOMETRY_WGSL,
    PIXEL_TRIANGLE_WGSL,
    CACHE_READ_WGSL,
    visTriangle,
  ],
)
