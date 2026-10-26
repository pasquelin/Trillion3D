import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { WORKGROUP_THREADS, GROUP_GRID_WGSL } from '../../../gpu/dispatch/grid.ts'
import { PRIORITY_HISTOGRAM_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { CARD_PAGE_WORDS } from '../../../../../sdk-core/src/lighting/surfaceCache/pageRecords.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { lightingCommonWgsl } from './commonWgsl.ts'
import { CONTEXT_HEADER_WORDS } from './layout.ts'

/**
 * THE UPDATE CONTEXT: which tiles of which pages the image lights, chosen on the GPU from the pages' own records
 * (`lightingMath.ts` holds the laws). In this order, each its own dispatch:
 *
 * - `contextClear` empties the header;
 * - `contextHistogram`, a thread a page, puts the page's tiles in the bucket its priority gives it, for each of the two
 *   updates: a page's bucket is 15 less the log2 of four times the images since it was lit times its speed — one over
 *   one plus its distance from the eye over the first clipmap's half side, doubled within the prioritised distance of
 *   the frustum's planes —, a page never lit having waited 2048 images;
 * - `contextSelect` takes the bucket whose tiles bring the sum to the update's budget, and the tiles of it that fit;
 * - `contextList`, a thread a page, lists the page's tiles where its bucket is under the cut, or in it while its
 *   bucket's tiles fit, and the list keeps to the budget — the tiles are written where the page's count is added to the
 *   list's, so every page that did not fit leaves the list closed to the pages after it —; a page listed is lit this
 *   image (its last update is the image's, its temporal index one more). Where the radiosity's history was lost the
 *   pages' last radiosity is forgotten first;
 * - `contextArgs` writes the dispatches that follow, a group a tile of each list.
 *
 * The pages' records are the tables' (`pageRecords.ts`): words 16 to 19 of a page's record hold the lighting's own state,
 * the image of the last direct and the last indirect update and the number of each, which this program writes.
 */

const PAGE_STATE = wgslConsts({
  PAGE_LAST_UPDATE: CARD_PAGE_WORDS - 4,
  PAGE_TEMPORAL: CARD_PAGE_WORDS - 2,
  BUCKETS: PRIORITY_HISTOGRAM_SIZE,
  NEVER_LIT_FRAMES: 2048,
  CLEAR_WORDS: CONTEXT_HEADER_WORDS,
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
  'contextArgs',
] as const

export const CONTEXT_WGSL = wgslProgram(
  `${PAGE_STATE}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn contextClear(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<CLEAR_WORDS;i+=${WORKGROUP_THREADS}u){atomicStore(&ctx[i],0u);}
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
fn updateSpeed(view:PageView)->f32{
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
 let speed=updateSpeed(pageView(page));
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
/** Lists the tiles of \`page\` in list \`c\` where its bucket and the budgets allow it. */
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
 let at=select(lp.indirectAt,lp.directAt,c==LG_LIST_DIRECT)+base;
 let across=pageSize(page).x/LG_TILE;
 for(var t=0u;t<tiles;t++){atomicStore(&ctx[at+t],page|((t%across)<<24u)|((t/across)<<28u));}
 atomicAdd(&ctx[CTX_LISTED+c],tiles);
 return true;
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn contextList(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let page=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 if(page>=lp.pages||!pageMapped(page)){return;}
 let tiles=pageTilesOf(page);
 if(tiles==0u){return;}
 let speed=updateSpeed(pageView(page));
 let state=scPageAt(page);
 for(var c=0u;c<2u;c++){
  var last=scPageW(page,PAGE_LAST_UPDATE+c);
  if(c==1u&&!lgFlag(FLAG_HISTORY_VALID)){last=0u;surfaceTables[state+PAGE_LAST_UPDATE+c]=0u;}
  if(tryList(page,c,priorityBucket(last,speed),tiles)){
   surfaceTables[state+PAGE_LAST_UPDATE+c]=lp.frame;
   surfaceTables[state+PAGE_TEMPORAL+c]=scPageW(page,PAGE_TEMPORAL+c)+1u;
  }
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
