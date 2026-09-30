import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { pageModelWgsl } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import {
  LAMP_FACE_ENTRIES,
  SUN_WINDOW,
  sunLevelEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SUN_ORIGIN_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { POOL_FRAME_COUNTS, SHADOW_DRAW_LIST_WGSL, shadowPoolWgsl } from './poolWgsl.ts';

/** Invocations of the one workgroup that allocates a frame's pages. */
export const ALLOC_LANES = 256;
/** Words of the parameters before the host's asks: frame, pages, list cap, asks, where the
 *  candidates' keys start, the first frame whose asks no need evicts, then each slice's
 *  generation. */
export const ALLOC_PARAM_WORDS = 8 + MAX_SHADOW_SLICES;

/**
 * THE GPU ALLOCATION OF SHADOW PAGES (#1275): one workgroup, right after the per-pixel demand
 * (`demandWgsl.ts`), maps every page the frame asks for — the pixels' requests and the host's
 * floors (`requests.floors`), one list deduplicated by the request bitset — in that same frame,
 * before any page is drawn or read.
 *
 * 1. `claimShadowFloors`, its own dispatch before the demand: the counts zeroed, the host's asks
 *    claimed at the head of the request list — pixels that fill the list never push a floor out
 *    of it, so a floor is always asked for, never evicted, and a refused finer page always has its
 *    coarse page to read. Then `allocateShadowPages`, phase by phase, a barrier between each
 *    (`ALLOC_PHASES`):
 * 2. `followPages` — a page of a slice that dropped its pages since (`records.generation`), or of a
 *    sun level whose window no longer holds it, is freed, its word zeroed; a sun page is ranked
 *    again at this frame's finest level (`records.followSun`).
 * 3. `touchRequests` — an entry mapped becomes asked this frame, listed to draw while no draw
 *    for it landed (`listDraw`); one unmapped is a need, keyed coarsest first, then by entry.
 * 4. `listCandidates` — the pages a need may take: the free ones, by page, then every page not
 *    asked since frame `keepFrom`, least recently asked first, the finest first, then by page —
 *    the keys the host sorts by too (`shadowNeedKey`, `shadowEvictionKey`). `keepFrom` is this
 *    frame: a page evicted is one it does not read, and one a later frame reads again is mapped
 *    and drawn in that frame. A pool at its ceiling under a still view keeps what the view asked
 *    since it rested (`shadowKeptFrom`, the host's still cycle of #26): the jitter phases no
 *    longer take each other's pages frame after frame, a need past them is refused and reads the
 *    coarser page, and the image rests (#1345).
 * 5. Both lists sorted (`sortStep`, bitonic), then `assignPages`: need `i` takes candidate `i` —
 *    evicting what it mapped, whose word is zeroed —, its word written mapped and not readable,
 *    the page listed to draw, what it names decoded by the page model (`shadowEntryPage`). A need
 *    past the candidates is refused: every page is one this frame asks for.
 *
 * Sorted, the order is the atomics' no more: the same frame maps the same pages. The window is the
 * session's (`referenceMode.ts`), the ordinary constant by default.
 */
export const allocationWgsl = (pages = SUN_WINDOW) => `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
${shadowRequestWgsl(1, pages)}
@group(0) @binding(2) var<storage,read_write> shadowPool:ShadowPool;
@group(0) @binding(3) var<storage,read_write> keys:array<u32>;
struct ShadowAllocParams{frame:i32,pages:u32,listCap:u32,asks:u32,candidateBase:u32,keepFrom:i32,pad1:u32,pad2:u32,generation:array<u32,${MAX_SHADOW_SLICES}>,entries:array<u32>,}
@group(0) @binding(4) var<storage,read> params:ShadowAllocParams;
@group(0) @binding(5) var<storage,read_write> drawList:array<u32>;
${pageModelWgsl(pages)}
${SUN_ORIGIN_WGSL}
${shadowPoolWgsl(pages)}
const ALLOC_LANES:u32=${ALLOC_LANES}u;
const SUN_LEVEL_ENTRIES:i32=${sunLevelEntries(pages)};
const LAMP_FACE_ENTRIES:i32=${LAMP_FACE_ENTRIES};
const NO_KEY:u32=0xffffffffu;
fn shadowPoolPages()->u32{return params.pages;}
fn requestCount()->u32{return atomicLoad(&shadowRequests[0]);}
fn requestAt(i:u32)->u32{return atomicLoad(&shadowRequests[1u+i]);}
${SHADOW_DRAW_LIST_WGSL}
/** What entry \`e\` names in this frame's records — view, page, coarseness —, or a coarseness of -1
 *  when no light holds it: a sun level and its absolute page, or a lamp face · 16 + mip and its page. */
fn shadowEntryPage(e:u32)->vec4i{
 let slice=u32(e/SHADOW_TABLE_STRIDE);let info=shadows.records[slice].info;
 if(info.x<0.5||u32(info.w)!=slice*SHADOW_TABLE_STRIDE){return vec4i(-1);}
 let rel=i32(e-slice*SHADOW_TABLE_STRIDE);
 if(u32(info.x)==u32(SUN_LEVEL_COUNT)){
  let slot=i32(rel/SUN_LEVEL_ENTRIES);let rest=rel-slot*SUN_LEVEL_ENTRIES;
  let finest=i32(info.y);let level=shadowSunSlotLevel(slot,finest);let origin=sunOrigin(slice,slot);
  let ax=shadowRingPage(rest%SUN_WINDOW_PAGES,origin.x,SUN_WINDOW_PAGES);
  let ay=shadowRingPage(i32(rest/SUN_WINDOW_PAGES),origin.y,SUN_WINDOW_PAGES);
  return vec4i(level,ax,ay,shadowSunCoarseness(level,finest));
 }
 let face=i32(rel/LAMP_FACE_ENTRIES);
 if(face>=i32(info.x)){return vec4i(-1);}
 let rest=rel-face*LAMP_FACE_ENTRIES;let mip=shadowLampEntryMip(rest);
 let local=shadowLampEntryLocal(rest);let pages=shadowLampMipPages(mip);
 return vec4i(shadowLampView(face,mip),shadowFacePageX(pages,local),shadowFacePageY(pages,local),shadowLampCoarseness(mip));
}
fn beginAllocation(lane:u32){
 if(lane<${POOL_FRAME_COUNTS}u){countClear(lane);}
 for(var i=lane;i<params.asks;i+=ALLOC_LANES){requestShadowPage(params.entries[i]&ENTRY_MASK);}
}
fn followPages(lane:u32){
 for(var p=lane;p<params.pages;p+=ALLOC_LANES){
  let e=shadowPool.pages[poolAt(POOL_OWNER,p)];
  if(e<0){continue;}
  let slice=u32(u32(e)/SHADOW_TABLE_STRIDE);let info=shadows.records[slice].info;
  var kept=info.x>=0.5&&u32(shadowPool.pages[poolAt(POOL_GENERATION,p)])==params.generation[slice];
  if(kept&&u32(info.x)==u32(SUN_LEVEL_COUNT)){
   let level=shadowPool.pages[poolAt(POOL_VIEW,p)];let finest=i32(info.y);
   let origin=sunOrigin(slice,shadowRing(level,SUN_LEVEL_COUNT));
   let x=shadowWindowHolds(shadowPool.pages[poolAt(POOL_X,p)],origin.x,SUN_WINDOW_PAGES);
   let y=shadowWindowHolds(shadowPool.pages[poolAt(POOL_Y,p)],origin.y,SUN_WINDOW_PAGES);
   kept=shadowWindowHolds(level,finest,SUN_LEVEL_COUNT)*x*y==1;
   shadowPool.pages[poolAt(POOL_RANK,p)]=shadowSunCoarseness(level,finest);
  }
  if(!kept){shadows.table[u32(e)]=0u;shadowPool.pages[poolAt(POOL_OWNER,p)]=-1;}
 }
}
fn touchRequests(lane:u32){
 let listed=min(requestCount(),params.listCap);
 for(var i=lane;i<listed;i+=ALLOC_LANES){
  let e=requestAt(i)&ENTRY_MASK;let word=shadows.table[e];
  let p=word&PAGE_INDEX_MASK;
  if((word&PAGE_MAPPED)!=0u){
   shadowPool.pages[poolAt(POOL_REQUESTED,p)]=params.frame;
   if((word&PAGE_VALID)==0u&&shadowPool.pages[poolAt(POOL_DRAWNBY,p)]==DRAWN_NONE){listDraw(p);}
   continue;
  }
  let named=shadowEntryPage(e);
  if(named.w<0){continue;}
  keys[countNext(COUNT_NEEDS)]=u32(shadowNeedKey(named.w,i32(e)));
 }
}
fn listCandidates(lane:u32){
 for(var p=lane;p<params.pages;p+=ALLOC_LANES){
  let e=shadowPool.pages[poolAt(POOL_OWNER,p)];var key=p;
  if(e>=0){
   let asked=shadowPool.pages[poolAt(POOL_REQUESTED,p)];
   if(asked>=params.keepFrom){continue;}
   let age=params.frame-asked;
   key=u32(shadowEvictionKey(age,shadowPool.pages[poolAt(POOL_RANK,p)],i32(p)));
  }
  keys[params.candidateBase+countNext(COUNT_CANDIDATES)]=key;
 }
}
fn padKeys(lane:u32,base:u32,count:u32,span:u32){for(var i=count+lane;i<span;i+=ALLOC_LANES){keys[base+i]=NO_KEY;}}
fn sortStep(lane:u32,base:u32,span:u32,k:u32,j:u32){
 for(var i=lane;i<span;i+=ALLOC_LANES){
  let other=i^j;
  if(other<=i){continue;}
  let a=keys[base+i];let b=keys[base+other];
  if((a>b)==((i&k)==0u)){keys[base+i]=b;keys[base+other]=a;}
 }
}
fn assignPages(lane:u32,needs:u32,candidates:u32){
 for(var i=lane;i<needs;i+=ALLOC_LANES){
  if(i>=candidates){countOne(COUNT_REFUSED);continue;}
  let e=keys[i]&ENTRY_MASK;let p=keys[params.candidateBase+i]&PAGE_INDEX_MASK;
  let lost=shadowPool.pages[poolAt(POOL_OWNER,p)];
  if(lost>=0){shadows.table[u32(lost)]=0u;}
  let named=shadowEntryPage(e);
  shadowPool.pages[poolAt(POOL_OWNER,p)]=i32(e);
  shadowPool.pages[poolAt(POOL_REQUESTED,p)]=params.frame;
  shadowPool.pages[poolAt(POOL_RANK,p)]=named.w;
  shadowPool.pages[poolAt(POOL_VIEW,p)]=named.x;
  shadowPool.pages[poolAt(POOL_X,p)]=named.y;
  shadowPool.pages[poolAt(POOL_Y,p)]=named.z;
  shadowPool.pages[poolAt(POOL_GENERATION,p)]=i32(params.generation[u32(e/SHADOW_TABLE_STRIDE)]);
  shadowPool.pages[poolAt(POOL_DRAWNBY,p)]=DRAWN_NONE;
  shadows.table[e]=p|PAGE_MAPPED;
  countOne(COUNT_ALLOCATED);
  listDraw(p);
 }
}
/** The smallest power of two a bitonic sort of \`n\` keys spans. */
fn spanOf(n:u32)->u32{return 1u<<(32u-countLeadingZeros(max(n,2u)-1u));}
var<workgroup> needCount:u32;
var<workgroup> candidateCount:u32;
@compute @workgroup_size(${ALLOC_LANES}) fn claimShadowFloors(@builtin(local_invocation_index) lane:u32){beginAllocation(lane);}
@compute @workgroup_size(${ALLOC_LANES}) fn allocateShadowPages(@builtin(local_invocation_index) lane:u32){
 followPages(lane);storageBarrier();
 touchRequests(lane);storageBarrier();
 if(lane==0u){needCount=countRead(COUNT_NEEDS);}
 let needs=workgroupUniformLoad(&needCount);if(needs==0u){return;}
 listCandidates(lane);storageBarrier();
 if(lane==0u){candidateCount=countRead(COUNT_CANDIDATES);}let candidates=workgroupUniformLoad(&candidateCount);
 let needSpan=spanOf(needs);let candidateSpan=spanOf(candidates);
 padKeys(lane,0u,needs,needSpan);padKeys(lane,params.candidateBase,candidates,candidateSpan);storageBarrier();
 for(var k=2u;k<=needSpan;k=k<<1u){for(var j=k>>1u;j>0u;j=j>>1u){sortStep(lane,0u,needSpan,k,j);storageBarrier();}}
 for(var k=2u;k<=candidateSpan;k=k<<1u){for(var j=k>>1u;j>0u;j=j>>1u){sortStep(lane,params.candidateBase,candidateSpan,k,j);storageBarrier();}}
 assignPages(lane,needs,candidates);
}`;
/** The GPU allocation of the ordinary window: what a pass compiled without a session reads. */
export const ALLOCATION_WGSL = allocationWgsl();

/** The phases the allocation runs one after the other, a barrier between, once the floors are
 *  claimed (`beginAllocation`): what a test runs in order. */
export const ALLOC_PHASES = ['followPages', 'touchRequests', 'listCandidates'];
