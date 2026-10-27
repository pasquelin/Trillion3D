import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { WORKGROUP_THREADS, GROUP_GRID_WGSL } from '../../../gpu/dispatch/grid.ts'
import { PRIORITY_HISTOGRAM_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { zOrderDecode } from '../../../../../math/src/wgsl/integer.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FEEDBACK_AT } from '../feedbackLayout.ts'
import { lightingCommonWgsl } from './commonWgsl.ts'
import { CONTEXT_HEADER_WORDS, PAGE_ARGS_SLOT_WORDS, PAGE_LIGHTING } from './layout.ts'

/**
 * THE UPDATE CONTEXT: which tiles of which pages the image lights, chosen on the GPU from the pages' own records
 * (`lightingMath.ts` holds the laws). In this order, each its own dispatch:
 *
 * - `contextClear` empties the header and the count that opens the shadow traces' buffer (`shadowTraceWgsl.ts`);
 * - `contextHistogram`, a thread a page, puts the page's tiles in the bucket its priority gives it, for each of the two
 *   updates: a page's bucket is 15 less the log2 of four times the images since it was lit times its speed — one over
 *   one plus its distance from the eye over the first clipmap's half side, doubled within the prioritised distance of
 *   the frustum's planes, or four where the rays read the page at its finest level within the last two images (the
 *   feedback, `FLAG_FEEDBACK`), whatever the rest gave —, a page never lit having waited 2048 images;
 * - `contextSelect` takes the bucket whose tiles bring the sum to the update's budget, and the tiles of it that fit;
 * - `contextList`, a thread a page, lists the page where its bucket is under the cut, or in it while its
 *   bucket's tiles fit, and the list keeps to the budget — the page's tiles are added to the update's count, so every
 *   page that did not fit leaves the budget closed to the pages after it —; a page listed is lit this
 *   image (its last update is the image's, its temporal index one more), unless the update frame is frozen
 *   (`surfaceCacheFreezeUpdateFrame`): then the pages record nothing, and the next image lists the same. Where the
 *   radiosity's history was lost the pages' last radiosity is forgotten first;
 * - `contextPageArgs` writes the dispatches that cut the pages into tiles, four groups a page listed, a slot of
 *   `PAGE_ARGS_SLOT_WORDS` words an update;
 * - `spliceDirect` and `spliceIndirect`, of their own program (`SPLICE_WGSL`: a dispatch cannot take its size from a
 *   buffer it is bound to write), cut the pages of each update into tiles: a workgroup of 8 × 8 threads takes a quarter
 *   of a page of 16 × 16 tiles, a thread a tile, and appends its tiles to the update's list;
 * - `contextArgs` writes the dispatches that follow, a group a tile of each list.
 *
 * The pages' records are the tables' (`pageRecords.ts`): words 16 to 19 of a page's record hold the lighting's own state,
 * the image of the last direct and the last indirect update and the number of each, which this program writes.
 */

/** The side, in tiles, of the square of tiles a splice workgroup cuts: a page is cut by four of them. */
const SPLICE_EDGE = 8
const SPLICE_GROUPS_PER_PAGE = 4

const PAGE_STATE = wgslConsts({
  PAGE_LAST_UPDATE: PAGE_LIGHTING.lastUpdate,
  PAGE_TEMPORAL: PAGE_LIGHTING.temporal,
  BUCKETS: PRIORITY_HISTOGRAM_SIZE,
  NEVER_LIT_FRAMES: 2048,
  CLEAR_WORDS: CONTEXT_HEADER_WORDS,
  FEEDBACK_HI_RES: FEEDBACK_AT.lastUsedHiRes,
  SPLICE_GROUPS_PER_PAGE,
  PAGE_ARGS_SLOT: PAGE_ARGS_SLOT_WORDS,
})

/** The writer of a slot of dispatch arguments in the context's header, for a program that holds the context as atomics. */
export const ARGS_WRITER_WGSL = wgslBlock(
  'LIGHTING_ARGS_WRITER_WGSL',
  [GROUP_GRID_WGSL],
  `fn setArgs(slot:u32,groups:vec2u){
 let at=CTX_ARGS+slot*4u;
 atomicStore(&ctx[at],groups.x);atomicStore(&ctx[at+1u],groups.y);atomicStore(&ctx[at+2u],1u);
}`,
)

export const CONTEXT_ENTRIES = [
  'contextClear',
  'contextHistogram',
  'contextSelect',
  'contextList',
  'contextPageArgs',
  'contextArgs',
] as const

/** The context program's bindings beside the tables (1) and the context (2): the shadow traces, whose count it empties. */
export const CONTEXT_TRACES_BINDING = 3
/** The binding of the rays' feedback buffer, read: the image each page was last read at its finest level. */
export const CONTEXT_FEEDBACK_BINDING = 4
/** The binding of the page-splice dispatch arguments, written. */
export const CONTEXT_PAGE_ARGS_BINDING = 5

export const CONTEXT_WGSL = wgslProgram(
  `${PAGE_STATE}
@group(0) @binding(${CONTEXT_TRACES_BINDING}) var<storage,read_write> traces:array<atomic<u32>>;
@group(0) @binding(${CONTEXT_FEEDBACK_BINDING}) var<storage,read> feedback:array<u32>;
@group(0) @binding(${CONTEXT_PAGE_ARGS_BINDING}) var<storage,read_write> pageArgs:array<u32>;
@compute @workgroup_size(${WORKGROUP_THREADS})
fn contextClear(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<CLEAR_WORDS;i+=${WORKGROUP_THREADS}u){atomicStore(&ctx[i],0u);}
 if(lane==0u){atomicStore(&traces[0],0u);}
}
fn pageMapped(page:u32)->bool{return scPageW(page,0u)!=0xffffffffu;}
fn pageTilesOf(page:u32)->u32{let s=pageSize(page);return (s.x*s.y)/(LG_TILE*LG_TILE);}
struct PageView{distance:f32,near:bool}
/** The distance of the eye from the box of the page's part of its card and whether that box is within the prioritised
 *  distance of every plane of the frustum. */
fn pageView(page:u32)->PageView{
 let card=scCard(scPageW(page,0u));
 let uv0=vec2f(scPageF(page,4u),scPageF(page,5u));
 let uv1=vec2f(scPageF(page,6u),scPageF(page,7u));
 let e=card.extent;
 let centre=vec3f(e.x*(uv0.x+uv1.x-1.0),e.y*(1.0-uv0.y-uv1.y),0.0);
 let reach=vec3f(e.x*(uv1.x-uv0.x),e.y*(uv1.y-uv0.y),e.z);
 let toEye=lp.camera.xyz-card.origin;
 let eyeLocal=vec3f(dot(toEye,card.axisX),dot(toEye,card.axisY),dot(toEye,card.axisZ));
 var view:PageView;
 view.distance=length(max(abs(eyeLocal-centre)-reach,vec3f(0.0)));
 view.near=false;
 if(lgFlag(FLAG_PRIORITIZE_FRUSTUM)){
  let fromEye=card.axisX*centre.x+card.axisY*centre.y+card.axisZ*centre.z-toEye;
  let spread=abs(card.axisX)*reach.x+abs(card.axisY)*reach.y+abs(card.axisZ)*reach.z;
  var within=true;
  for(var k=0u;k<5u;k++){
   let plane=lp.frustum[k];
   within=within&&dot(plane.xyz,fromEye)+plane.w<=dot(spread,abs(plane.xyz))+lp.frustumDistance;
  }
  view.near=within;
 }
 return view;
}
/** The image the rays last read \`page\` at its finest level, 0 where they never did or the buffer holds no such part. */
fn pageLastUsedHiRes(page:u32)->u32{
 let at=feedback[FEEDBACK_HI_RES]+page;
 if(at>=arrayLength(&feedback)){return 0u;}
 return feedback[at];
}
fn updateSpeed(page:u32,view:PageView)->f32{
 if(lgFlag(FLAG_FEEDBACK)){
  let used=pageLastUsedHiRes(page);
  if(used+2u>=lp.frame&&used<=lp.frame){return 4.0;}
 }
 return select(1.0,2.0,view.near)/(1.0+max(view.distance*lp.firstClipmapRcp,0.0));
}
fn priorityBucket(last:u32,speed:f32)->u32{
 let waited=select(lp.frame-last,NEVER_LIT_FRAMES,last==0u);
 return u32(f32(BUCKETS-1u)-clamp(log2(max(4.0*f32(waited)*speed,1.0)),0.0,f32(BUCKETS-1u)));
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn contextHistogram(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let page=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 if(page>=lp.pages||!pageMapped(page)){return;}
 let tiles=pageTilesOf(page);
 if(tiles==0u){return;}
 let speed=updateSpeed(page,pageView(page));
 for(var c=0u;c<2u;c++){
  atomicAdd(&ctx[CTX_HISTOGRAM+c*BUCKETS+priorityBucket(scPageW(page,PAGE_LAST_UPDATE+c),speed)],tiles);
 }
}
@compute @workgroup_size(2)
fn contextSelect(@builtin(local_invocation_index) c:u32){
 let maxTiles=select(lp.indirectTiles,lp.directTiles,c==LG_LIST_DIRECT);
 var sum=0u;var bucket=0u;var inBucket=maxTiles;
 for(;bucket<BUCKETS;bucket++){
  let here=atomicLoad(&ctx[CTX_HISTOGRAM+c*BUCKETS+bucket]);
  if(sum+here>=maxTiles){inBucket=maxTiles-sum;break;}
  sum+=here;
 }
 atomicStore(&ctx[CTX_MAX_BUCKET+c*2u],bucket);
 atomicStore(&ctx[CTX_MAX_BUCKET+c*2u+1u],inBucket);
}
/** Lists \`page\` in the pages of update \`c\` where its bucket and the budgets allow it. */
fn tryList(page:u32,c:u32,bucket:u32,tiles:u32)->bool{
 let maxTiles=select(lp.indirectTiles,lp.directTiles,c==LG_LIST_DIRECT);
 var update=bucket<=atomicLoad(&ctx[CTX_MAX_BUCKET+c*2u]);
 if(update&&bucket==atomicLoad(&ctx[CTX_MAX_BUCKET+c*2u])){
  let before=atomicAdd(&ctx[CTX_ALLOCATED+c*2u+1u],tiles);
  update=before+tiles<=atomicLoad(&ctx[CTX_MAX_BUCKET+c*2u+1u]);
 }
 if(!update){return false;}
 let base=atomicAdd(&ctx[CTX_ALLOCATED+c*2u],tiles);
 if(base+tiles>maxTiles){return false;}
 let next=atomicAdd(&ctx[CTX_PAGES_LISTED+c],1u);
 if(next>=lp.pages){return false;}
 atomicStore(&ctx[select(lp.indirectPagesAt,lp.directPagesAt,c==LG_LIST_DIRECT)+next],page);
 return true;
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn contextList(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let page=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 if(page>=lp.pages||!pageMapped(page)){return;}
 let tiles=pageTilesOf(page);
 if(tiles==0u){return;}
 let speed=updateSpeed(page,pageView(page));
 let state=scPageAt(page);
 let record=!lgFlag(FLAG_FREEZE_UPDATE_FRAME);
 for(var c=0u;c<2u;c++){
  var last=scPageW(page,PAGE_LAST_UPDATE+c);
  if(c==1u&&!lgFlag(FLAG_HISTORY_VALID)){
   last=0u;
   if(record){surfaceTables[state+PAGE_LAST_UPDATE+c]=0u;}
  }
  if(tryList(page,c,priorityBucket(last,speed),tiles)&&record){
   surfaceTables[state+PAGE_LAST_UPDATE+c]=lp.frame;
   surfaceTables[state+PAGE_TEMPORAL+c]=scPageW(page,PAGE_TEMPORAL+c)+1u;
  }
 }
}
@compute @workgroup_size(1)
fn contextPageArgs(){
 for(var c=0u;c<2u;c++){
  let groups=groupGrid(SPLICE_GROUPS_PER_PAGE*atomicLoad(&ctx[CTX_PAGES_LISTED+c]));
  let at=c*PAGE_ARGS_SLOT;
  pageArgs[at]=groups.x;pageArgs[at+1u]=groups.y;pageArgs[at+2u]=1u;
 }
}
@compute @workgroup_size(1)
fn contextArgs(){
 let direct=atomicLoad(&ctx[CTX_LISTED+LG_LIST_DIRECT]);
 let indirect=atomicLoad(&ctx[CTX_LISTED+LG_LIST_INDIRECT]);
 setArgs(ARGS_DIRECT_TILES,groupGrid(direct));
 setArgs(ARGS_INDIRECT_TILES,groupGrid(indirect));
}`,
  [
    lightingCommonWgsl({
      tables: 1,
      tablesAccess: 'read_write',
      context: { binding: 2, access: 'atomic' },
    }),
    ARGS_WRITER_WGSL,
  ],
)

export const SPLICE_ENTRIES = ['spliceDirect', 'spliceIndirect'] as const

/** The splice's bindings: the context (2), written, beside the tables (1). */
export const SPLICE_CONTEXT_BINDING = 2

const SPLICE_STATE = wgslConsts({
  SPLICE_EDGE,
  SPLICE_GROUPS_PER_PAGE,
})

/** The program that cuts the pages each update listed into tiles. */
export const SPLICE_WGSL = wgslProgram(
  `${SPLICE_STATE}
var<workgroup> splicedCount:atomic<u32>;
var<workgroup> splicedTiles:array<u32,SPLICE_EDGE*SPLICE_EDGE>;
var<workgroup> splicedAt:u32;
/** A workgroup cuts the quarter \`group % 4\` of the page \`group / 4\` of update \`c\`'s page list into tiles, a thread a tile
 *  in the quarter, and appends the tiles it made together to the update's tiles. */
fn splice(c:u32,thread:u32,group:u32){
 if(thread==0u){atomicStore(&splicedCount,0u);splicedAt=0u;}
 workgroupBarrier();
 let quarter=group%SPLICE_GROUPS_PER_PAGE;
 let rank=group/SPLICE_GROUPS_PER_PAGE;
 let inQuarter=zOrderDecode(thread);
 let coord=vec2u((quarter%2u)*SPLICE_EDGE+inQuarter.x,(quarter/2u)*SPLICE_EDGE+inQuarter.y);
 if(rank<atomicLoad(&ctx[CTX_PAGES_LISTED+c])){
  let page=atomicLoad(&ctx[select(lp.indirectPagesAt,lp.directPagesAt,c==LG_LIST_DIRECT)+rank]);
  if(all(coord<pageSize(page)/LG_TILE)){
   splicedTiles[atomicAdd(&splicedCount,1u)]=page|(coord.x<<24u)|(coord.y<<28u);
  }
 }
 workgroupBarrier();
 let made=atomicLoad(&splicedCount);
 if(thread==0u&&made>0u){splicedAt=atomicAdd(&ctx[CTX_LISTED+c],made);}
 workgroupBarrier();
 if(thread<made){
  atomicStore(&ctx[select(lp.indirectAt,lp.directAt,c==LG_LIST_DIRECT)+splicedAt+thread],splicedTiles[thread]);
 }
}
@compute @workgroup_size(SPLICE_EDGE,SPLICE_EDGE)
fn spliceDirect(@builtin(local_invocation_index) thread:u32,@builtin(workgroup_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 splice(LG_LIST_DIRECT,thread,flatGroup(g,n));
}
@compute @workgroup_size(SPLICE_EDGE,SPLICE_EDGE)
fn spliceIndirect(@builtin(local_invocation_index) thread:u32,@builtin(workgroup_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 splice(LG_LIST_INDIRECT,thread,flatGroup(g,n));
}
`,
  [
    lightingCommonWgsl({
      tables: 1,
      context: { binding: SPLICE_CONTEXT_BINDING, access: 'atomic' },
    }),
    zOrderDecode,
  ],
)
