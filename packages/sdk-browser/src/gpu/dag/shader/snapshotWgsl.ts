import { REQUEST_PRIORITY_MAX } from '../request.ts';

/**
 * SNAPSHOT write: what the GPU reports to the CPU, and the ceiling that bounds it.
 *
 * The snapshot is the only thing a frame brings back down from the GPU. The draw mask stays
 * in place — compute raster reads it where `dagMask` put it —, so what passes here never
 * serves to draw: it serves to BROADCAST. From it the host takes the pages it must load, pin
 * or return to the cache.
 *
 * Each rank is a REQUEST: the page and the priority the host will give it in its upload queue,
 * in a single word (`../request.ts`).
 *
 * The ceiling (`SELECTION_LIST_CAP`, `../layout.ts`) bounds what the frame copy takes. A
 * refused rank sets bit 0: the snapshot is then TRUNCATED, and the frame refuses it whole
 * rather than adopt it amputated. Frame totals lose nothing — they describe the cut, not the
 * list that reports it (`totalsWgsl.ts`).
 *
 * The camera's requests are STAGED behind the drawn list, where the frame copy never reads, in
 * the order the threads won the counter, and the view ahead's behind them, on their own counter;
 * `dagSortRequests` then writes both into the snapshot by `requestRank`, highest first: the
 * camera's whole, then as many ahead as the cap leaves (`OUT_AHEAD_PLACED`, `../layout.ts`). The
 * host reads them in that order and ranks nothing.
 */
export const DAG_READING_WGSL = `/** One of the camera's requests in the sample; past the cap it is dropped, and the sample says it
 *  is truncated. */
fn emitOne(page:u32,pixels:f32){
 let slot=atomicAdd(&out.count,1u);
 if(slot>=views[0u].listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[stagedAt(slot)]=packRequest(page,quantizePriority(pixels));
}
/** Where the camera's request \`s\` waits for the sort: behind the cut's two lists' differences
 *  (\`stagedRequestsWord\`, \`../layout.ts\`, less \`out\`'s header: an index of \`out.pages\`). */
fn stagedAt(s:u32)->u32{return differenceAt(2u*views[0u].listCap+s);}
/** The requests ahead one sample stages (\`aheadRequestCap\`, \`../layout.ts\`), and where the
 *  request ahead \`s\` waits: behind the camera's whole staged region, which it never enters. */
fn aheadCap()->u32{return views[0u].listCap/2u;}
fn aheadStagedAt(s:u32)->u32{return stagedAt(views[0u].listCap)+s;}
/** A request of the view ahead (\`aheadWgsl.ts\`), due \`due\` of the horizon from now: the lower
 *  tier, on its own counter and in its own region. Past its cap it is dropped, never declared: the
 *  camera's requests keep the whole sample, and their overflow alone makes it truncated. */
fn emitAhead(page:u32,pixels:f32,due:f32){
 let slot=atomicAdd(&out.ahead,1u);
 if(slot<aheadCap()){out.pages[aheadStagedAt(slot)]=packRequest(page,aheadPriority(pixels,due));}
}
/** True once the region ahead is full: the view ahead asks for nothing more this frame. */
fn aheadFull()->bool{return atomicLoad(&out.ahead)>=aheadCap();}
/** Staged request \`s\` of the sort: the camera's \`n\` first, then those ahead. */
fn stagedWord(s:u32,n:u32)->u32{
 if(s<n){return out.pages[stagedAt(s)];}
 return out.pages[aheadStagedAt(s-n)];
}
const RANKS:u32=${REQUEST_PRIORITY_MAX + 1}u;
const SORT_LANES:u32=256u;
var<workgroup> rankPlace:array<atomic<u32>,RANKS>;
/** Counting sort of the staged requests into the snapshot, one workgroup: count each rank, give
 *  each rank its first place from the highest down, then scatter. Within a rank the order is the
 *  threads', as it was the counter's: the rank alone orders. */
@compute @workgroup_size(SORT_LANES)
fn dagSortRequests(@builtin(local_invocation_index) lane:u32){
 let cap=views[0u].listCap;let n=min(atomicLoad(&out.count),cap);let total=n+min(atomicLoad(&out.ahead),aheadCap());
 for(var r=lane;r<RANKS;r+=SORT_LANES){atomicStore(&rankPlace[r],0u);}
 workgroupBarrier();
 for(var s=lane;s<total;s+=SORT_LANES){atomicAdd(&rankPlace[requestWordRank(stagedWord(s,n))],1u);}
 workgroupBarrier();
 // Every request ahead ranks below every one of the camera's: they fill what the camera leaves.
 if(lane==0u){out.aheadPlaced=min(placeRanks(),cap)-n;}
 workgroupBarrier();
 for(var s=lane;s<total;s+=SORT_LANES){let word=stagedWord(s,n);let at=atomicAdd(&rankPlace[requestWordRank(word)],1u);if(at<cap){out.pages[at]=word;}}
}
/** Turns each rank's count into its first place, from the highest rank down; returns the total. */
fn placeRanks()->u32{
 var place=0u;
 for(var r=RANKS;r>0u;r--){let held=atomicLoad(&rankPlace[r-1u]);atomicStore(&rankPlace[r-1u],place);place+=held;}
 return place;
}
`;
