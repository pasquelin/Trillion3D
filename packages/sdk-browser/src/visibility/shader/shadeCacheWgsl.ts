import { INVERSE_TRANSPOSE_WGSL } from '../../math/inverseTransposeWgsl.ts';
import { VIS_MAX_PAGE_TRIANGLES, VIS_TRIANGLE_BITS } from '../visWords.ts';
import { DAG_GRID_WGSL, FLAT_INDEX_WGSL } from '../../gpu/dag/shader/gridWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL, PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts';
import {
  FRAMEBUFFER_WGSL,
  PIXEL_TRIANGLE_WGSL,
  SHADE_UNI_WGSL,
  VERTEX_NORMALS_WGSL,
} from './pixelTriangleWgsl.ts';

/**
 * THE RESOLVE'S FRAME CACHE (`shadeCache`): what many pixels used to compute alike, computed once
 * a frame by compute passes before the class draws (`../../webgpu/visibility/shadeCache.ts`) and
 * read back word for word by the resolve (`shadeWgsl.ts`). Each pass calls the very function the
 * pixel calls without it, on the same inputs, and a float travels as its bits: what a pixel reads
 * is what it would have computed. Each pass's work follows what the image reads, never the
 * table's size.
 *
 * - A row's frame: the inverse transpose of its world's 3×3 (`invTranspose3Prep`: a
 *   normalisation, nine divisions, three cross products) and the side of its determinant, for a
 *   row a pixel reads — a mark in either plane. A row no pixel reads keeps words nothing reads.
 * - A triangle: `decodeTriangle` — the page's header, corners, positions, normals and texture
 *   coordinates decoded, the world and camera products, the framebuffer and perspective
 *   divisions —, forty-two words, for each triangle two pixels or more of the visibility buffer
 *   read. One pixel alone gains nothing from a decode it would pay once either way, and keeps
 *   its own.
 *
 * The marks pass reads the visibility buffer by 8×8 tiles: a pixel whose left or upper neighbour
 * in its tile holds its triangle proves it read twice and sets plane B; a pixel that starts a run
 * met nowhere above sets plane A, and plane B when A already held the triangle. B is set exactly
 * for the triangles read by two pixels or more; past their first pixels, a triangle's pixels read B and write nothing. The rows pass
 * then composes the frames, counts each row's B triangles, takes their slots with one atomic add
 * on the cursor, and keeps where each B word's triangles start (a byte each: at most 224
 * triangles precede the last word); a row past the capacity clears its B words, and its pixels
 * decode, as without the cache. A row that fits writes each slot's triangle — its row and index —
 * in the slot's first word, raises the end of the fitting slots and the triangles pass's dispatch
 * (`openSlice`); the slots fill from zero in the cursor's order, so the rows that fit hold every
 * slot below that end. The triangles pass then decodes one triangle per lane, over those slots
 * alone, and stores it over its first word. A pixel's slot is its row's first slot, the count
 * before its word, and the B bits below its own (`cachedSlot`).
 *
 * Words: the header — the triangle cursor, the rows the sections are laid for, the triangle
 * capacity, both written by the host each frame, the end of the fitting slots —, a record per row
 * (its frame, its first slot, its two prefix words), the marks — planes A then B, 8 words each,
 * the 256 triangles a visibility identifier addresses —, then the triangles. A row at or past the
 * header's count is composed and decoded by its pixels.
 */
const SHADE_CACHE_CURSOR_WORD = 0;
export const SHADE_CACHE_ROWS_WORD = 1;
export const SHADE_CACHE_CAPACITY_WORD = 2;
const SHADE_CACHE_END_WORD = 3;
export const SHADE_CACHE_HEADER_WORDS = SHADE_CACHE_END_WORD + 1;
/** A row's frame as `storeRowFrame` writes it: the adjugate's nine words, its scale, whether it is
 *  regular, the side of the determinant. Its first slot follows, then its two prefix words. */
const ROW_FRAME_WORDS = 12;
export const ROW_RECORD_WORDS = 16;
export const ROW_MARK_WORDS = 16;
export const TRIANGLE_WORDS = 42;
/** Triangles a visibility identifier addresses in a row: its low byte. */
export const ROW_TRIANGLES = 256;
/** Rows a workgroup of the rows pass handles; the triangles pass's lanes per row. */
export const SHADE_ROWS_LANES = 64;
/** The marks pass's tile side. */
export const MARK_TILE = 8;

const LAYOUT_WGSL = `const SHADE_CACHE_CURSOR:u32=${SHADE_CACHE_CURSOR_WORD}u;
const SHADE_CACHE_ROWS:u32=${SHADE_CACHE_ROWS_WORD}u;
const SHADE_CACHE_CAPACITY:u32=${SHADE_CACHE_CAPACITY_WORD}u;
const SHADE_CACHE_END:u32=${SHADE_CACHE_END_WORD}u;
const ROW_RECORDS:u32=${SHADE_CACHE_HEADER_WORDS}u;
const ROW_RECORD_WORDS:u32=${ROW_RECORD_WORDS}u;
const ROW_BASE:u32=${ROW_FRAME_WORDS}u;
const ROW_PREFIX:u32=${ROW_FRAME_WORDS + 1}u;
const ROW_MARK_WORDS:u32=${ROW_MARK_WORDS}u;
const PLANE_WORDS:u32=${ROW_MARK_WORDS / 2}u;
const TRIANGLE_WORDS:u32=${TRIANGLE_WORDS}u;
const NO_SLOT:u32=0xffffffffu;
/** Plane A of row \`row\`'s marks, of \`rows\` laid; plane B follows it. */
fn rowMarks(rows:u32,row:u32)->u32{return ROW_RECORDS+rows*ROW_RECORD_WORDS+row*ROW_MARK_WORDS;}
/** The first word of the triangles, of \`rows\` laid. */
fn cachedTriangles(rows:u32)->u32{return ROW_RECORDS+rows*(ROW_RECORD_WORDS+ROW_MARK_WORDS);}
/** The passes ran this frame: the pixels read what they stored. */
override SHADE_CACHE:bool=false;`;

/** A row's frame and its composition, the one text the passes and the resolve compile. Requires
 *  `INVERSE_TRANSPOSE_WGSL`. */
const ROW_FRAME_WGSL = `${LAYOUT_WGSL}
/** The normal matrix of a row and the side of its world's determinant (\`matrixWindingCw\`). */
struct RowFrame{invT:InvT3,positive:bool,}
fn composeRowFrame(world:mat4x4f)->RowFrame{
 let world3=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 return RowFrame(invTranspose3Prep(world3),determinant(world3)>=0.0);
}`;

/** Reads of the cache as plain words — the resolve's, and the triangles pass's. */
const CACHE_READ_WGSL = `${ROW_FRAME_WGSL}
fn cacheVec2(at:u32)->vec2f{return bitcast<vec2f>(vec2u(shadeCache[at],shadeCache[at+1u]));}
fn cacheVec3(at:u32)->vec3f{return bitcast<vec3f>(vec3u(shadeCache[at],shadeCache[at+1u],shadeCache[at+2u]));}
fn cacheVec4(at:u32)->vec4f{return bitcast<vec4f>(vec4u(shadeCache[at],shadeCache[at+1u],shadeCache[at+2u],shadeCache[at+3u]));}
/** Row \`row\`'s frame: as the rows pass stored it, or composed here from \`world\`. */
fn rowFrame(row:u32,world:mat4x4f)->RowFrame{
 if(!SHADE_CACHE||row>=shadeCache[SHADE_CACHE_ROWS]){return composeRowFrame(world);}
 let at=ROW_RECORDS+row*ROW_RECORD_WORDS;
 let adj=mat3x3f(cacheVec3(at),cacheVec3(at+3u),cacheVec3(at+6u));
 return RowFrame(InvT3(adj,bitcast<f32>(shadeCache[at+9u]),shadeCache[at+10u]!=0u),shadeCache[at+11u]!=0u);
}
/** The slot of triangle \`tri\` of row \`row\`, \`NO_SLOT\` for one the cache does not hold. */
fn cachedSlot(row:u32,tri:u32)->u32{
 let rows=shadeCache[SHADE_CACHE_ROWS];
 if(!SHADE_CACHE||row>=rows){return NO_SLOT;}
 let word=shadeCache[rowMarks(rows,row)+PLANE_WORDS+(tri>>5u)];
 let bit=1u<<(tri&31u);
 if((word&bit)==0u){return NO_SLOT;}
 let record=ROW_RECORDS+row*ROW_RECORD_WORDS;
 let before=(shadeCache[record+ROW_PREFIX+(tri>>7u)]>>(((tri>>5u)&3u)*8u))&255u;
 return shadeCache[record+ROW_BASE]+before+countOneBits(word&(bit-1u));
}`;

/**
 * The resolve's read: its binding, read-only, the frames and `pixelTriangle`. The overrides are set
 * by the pipelines when the passes run this frame (`shadeCacheConstants`); left false, a pixel
 * composes and decodes its own, as before.
 */
export const shadeCacheReadWgsl = (binding: number) => `
@group(0) @binding(${binding}) var<storage, read> shadeCache:array<u32>;
${CACHE_READ_WGSL}
/** The triangle a pixel of row \`row\` shades: as the triangles pass stored it, or decoded here. */
fn pixelTriangle(row:u32,page:PageInfo,tri:u32)->PixelTriangle{
 let slot=cachedSlot(row,tri);
 if(slot==NO_SLOT){return decodeTriangle(page,tri,rowFrame(row,page.world).invT);}
 let at=cachedTriangles(shadeCache[SHADE_CACHE_ROWS])+slot*TRIANGLE_WORDS;
 return PixelTriangle(cacheVec4(at),cacheVec4(at+4u),cacheVec4(at+8u),cacheVec4(at+12u),cacheVec4(at+16u),cacheVec4(at+20u),
  cacheVec3(at+24u),cacheVec3(at+27u),cacheVec3(at+30u),cacheVec2(at+33u),cacheVec2(at+35u),cacheVec2(at+37u),cacheVec3(at+39u));
}`;

/** The marks and rows passes, on the cache's words as atomics; \`work\`, the triangles pass's
 *  dispatch, x then y. */
export const SHADE_CACHE_SHADER = `${PAGE_INFO_STRUCT_WGSL}
@group(0) @binding(0) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(1) var<storage,read_write> shadeCache:array<atomic<u32>>;
@group(0) @binding(2) var vis:texture_2d<u32>;
@group(0) @binding(3) var<storage,read_write> work:array<atomic<u32>,3>;
${INVERSE_TRANSPOSE_WGSL}
${DAG_GRID_WGSL}
${ROW_FRAME_WGSL}
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
 let at=rowMarks(rows,row)+(tri>>5u);let bit=1u<<(tri&31u);
 if(kind==0u||(atomicLoad(&shadeCache[at+PLANE_WORDS])&bit)!=0u){return;}
 if(kind==2u||(atomicOr(&shadeCache[at],bit)&bit)!=0u){atomicOr(&shadeCache[at+PLANE_WORDS],bit);}
}
/** What the marks and rows passes count from zero — every row's marks, the slots' cursor and the
 *  end of the fitting ones, and the triangles pass's dispatch, x and y — zeroed by the frame's
 *  first dispatch, one lane per mark word, rows by \`flatIndex\` (\`gridWgsl.ts\`). */
@compute @workgroup_size(${SHADE_ROWS_LANES}) fn shade_clear(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g.x,g.y,n.x);
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
 markTriangle(rows,(id>>${VIS_TRIANGLE_BITS}u)-1u,id&0xffu,markKind(id,left,leftLeft,up));
}
/**
 * Row \`row\`'s marks, read once: its frame composed when a pixel reads it, then the slots of its
 * B triangles taken with one atomic add, or its B words cleared past the capacity. A row that fits
 * writes each slot's triangle in the slot's first word, raises the end of the fitting slots and
 * the triangles pass's dispatch.
 */
@compute @workgroup_size(${SHADE_ROWS_LANES}) fn shade_rows(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(g.x,g.y,n.x);
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
 openSlice(0u,(base+count-1u)>>6u);
}`;

/** The triangles pass, the page decoded by the resolve's own text. */
export const SHADE_TRIS_SHADER = `${PAGE_INFO_STRUCT_WGSL}
${SHADE_UNI_WGSL}
${FLAT_INDEX_WGSL}@group(0) @binding(0) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(1) var<storage,read_write> shadeCache:array<u32>;
@group(0) @binding(2) var<storage,read> indices:array<u32>;
@group(0) @binding(3) var<storage,read> positions:array<f32>;
@group(0) @binding(4) var<storage,read> uvs:array<f32>;
@group(0) @binding(5) var<uniform> uni:ShadeUni;
${normalAtlasWgsl(6)}
${PAGE_GEOMETRY_WGSL}
${PAGE_SCREEN_WGSL}
${PAGE_NORMAL_WGSL}
${FRAMEBUFFER_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${VERTEX_NORMALS_WGSL}
${PIXEL_TRIANGLE_WGSL}
${CACHE_READ_WGSL}
fn storeVec(at:u32,v:vec4f,size:u32){let b=bitcast<vec4u>(v);for(var k=0u;k<size;k++){shadeCache[at+k]=b[k];}}
fn storeTriangle(at:u32,t:PixelTriangle){
 storeVec(at,t.p0,4u);storeVec(at+4u,t.p1,4u);storeVec(at+8u,t.p2,4u);
 storeVec(at+12u,t.w0,4u);storeVec(at+16u,t.w1,4u);storeVec(at+20u,t.w2,4u);
 storeVec(at+24u,vec4f(t.n0,0.0),3u);storeVec(at+27u,vec4f(t.n1,0.0),3u);storeVec(at+30u,vec4f(t.n2,0.0),3u);
 storeVec(at+33u,vec4f(t.uva,0.0,0.0),2u);storeVec(at+35u,vec4f(t.uvb,0.0,0.0),2u);storeVec(at+37u,vec4f(t.uvc,0.0,0.0),2u);
 storeVec(at+39u,vec4f(t.iw,0.0),3u);
}
/** One lane per slot below the end of the fitting slots, by \`flatIndex\`'s rank: the triangle its
 *  first word names. */
@compute @workgroup_size(${SHADE_ROWS_LANES}) fn shade_tris(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=flatIndex(g.x,g.y,n.x);
 if(slot>=shadeCache[SHADE_CACHE_END]){return;}
 let at=cachedTriangles(shadeCache[SHADE_CACHE_ROWS])+slot*TRIANGLE_WORDS;
 let row=shadeCache[at]>>${VIS_TRIANGLE_BITS}u;let tri=shadeCache[at]&0xffu;
 let page=pages[row];
 // A triangle past its page is marked, never read: its pixel shades nothing.
 if(tri*3u+2u>=page.indexCount){return;}
 storeTriangle(at,decodeTriangle(page,tri,rowFrame(row,page.world).invT));
}`;
