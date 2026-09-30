import {
  SUN_WINDOW,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Words of one bit per table entry of a session's window. */
export const shadowEntryBits = (pages = SUN_WINDOW) => shadowTableEntries(pages) / 32;

/** The claim of page `e` by one lane: its bit tested before the atomic, then set, and the page
 *  listed by whoever set it first — so a page thousands of pixels read costs one list slot. */
const claimWgsl = (name: string, entryBits: number) => `fn ${name}(e:u32){
 let cap=arrayLength(&shadowRequests)-${1 + entryBits}u;let word=1u+cap+(e>>5u);let bit=1u<<(e&31u);
 if((atomicLoad(&shadowRequests[word])&bit)!=0u){return;}
 if((atomicOr(&shadowRequests[word],bit)&bit)!=0u){return;}
 let at=atomicAdd(&shadowRequests[0],1u);
 if(at<cap){atomicStore(&shadowRequests[1u+at],e);}
}`;

/** The per-lane request, every device's: each lane claims its own page. The fallback of
 *  `SUBGROUP_REQUEST_WGSL`, and the text `withSubgroupShadowRequests` replaces. */
export const laneRequestWgsl = (pages = SUN_WINDOW) =>
  claimWgsl('requestShadowPage', shadowEntryBits(pages));

/** Election rounds a subgroup runs before its lanes left claim their own pages: a bound on the
 *  serial work of a subgroup whose lanes read many pages, never a change of the pages asked for. */
const SUBGROUP_REQUEST_ROUNDS = 4;

/**
 * The request per subgroup (OMB-21, #966), when the device granted `subgroups`: the active lanes
 * take their pages in turn, the first lane's page, then the next one left, and one lane of those
 * that ask for it claims it — one claim, hence one global atomic, per distinct page and subgroup
 * where each lane made its own. A claim is idempotent, so the bits set, the count and the pages
 * listed are those of `LANE_REQUEST_WGSL` (the list's order is free), whatever the device
 * reconverges and however many rounds run: a lane still waiting after the last claims its own.
 *
 * Only a lane the pass says asks (`shadowRequesting`) is elected: any other — a helper invocation,
 * whose atomics touch nothing, or a pass that never said — claims its own page, so no helper is
 * elected in place of a pixel that asks for its page, and a pass that forgets asks per lane.
 */
export const subgroupRequestWgsl = (pages = SUN_WINDOW) =>
  `${claimWgsl('shadowClaimPage', shadowEntryBits(pages))}
fn requestShadowPage(e:u32){
 if(!shadowRequesting){shadowClaimPage(e);return;}
 for(var round=0u;round<${SUBGROUP_REQUEST_ROUNDS}u;round++){
  let first=subgroupBroadcastFirst(e);
  if(e==first){
   if(subgroupElect()){shadowClaimPage(e);}
   return;
  }
 }
 shadowClaimPage(e);
}`;
