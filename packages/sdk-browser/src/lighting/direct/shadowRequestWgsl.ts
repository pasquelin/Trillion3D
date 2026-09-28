import { SHADOW_TABLE_ENTRIES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Words of the request buffer after the count and a list as long as the pool's (`shadowRequestCap`,
 *  read at run time): one bit per table entry — a page is listed once however many pixels read it. */
export const SHADOW_REQUEST_BITS = SHADOW_TABLE_ENTRIES / 32;

/** The claim of page `e` by one lane: its bit tested before the atomic, then set, and the page
 *  listed by whoever set it first — so a page thousands of pixels read costs one list slot. */
const claimWgsl = (name: string) => `fn ${name}(e:u32){
 let cap=arrayLength(&shadowRequests)-${1 + SHADOW_REQUEST_BITS}u;let word=1u+cap+(e>>5u);let bit=1u<<(e&31u);
 if((atomicLoad(&shadowRequests[word])&bit)!=0u){return;}
 if((atomicOr(&shadowRequests[word],bit)&bit)!=0u){return;}
 let at=atomicAdd(&shadowRequests[0],1u);
 if(at<cap){atomicStore(&shadowRequests[1u+at],e);}
}`;

/** The per-lane request, every device's: each lane claims its own page. The fallback of
 *  `SUBGROUP_REQUEST_WGSL`, and the text `withSubgroupShadowRequests` replaces. */
export const LANE_REQUEST_WGSL = claimWgsl('requestShadowPage');

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
export const SUBGROUP_REQUEST_WGSL = `${claimWgsl('shadowClaimPage')}
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

/**
 * What a reading asks of the scheduler. The shading that marks writes the page into the request
 * buffer the first time any pixel reads it this frame, a bit per table entry. A pass that does
 * not mark — the blend forward stage, which keeps its early depth reject — reads without asking.
 * `shadowRequesting` is the pass's to set on a lane that asks per subgroup.
 */
export const shadowRequestWgsl = (binding: number | null) =>
  binding === null
    ? 'fn requestShadowPage(e:u32){}'
    : `@group(0) @binding(${binding}) var<storage,read_write> shadowRequests:array<atomic<u32>>;
var<private> shadowRequesting:bool=false;
${LANE_REQUEST_WGSL}`;

/**
 * `shader`, a text that asks with `LANE_REQUEST_WGSL`, asking per subgroup instead: the feature
 * enabled, and the uniformity diagnostic off — the request runs in the pixel's own control flow,
 * and the loop above holds for any set of active lanes.
 */
export function withSubgroupShadowRequests(shader: string) {
  const swapped = shader.replace(LANE_REQUEST_WGSL, () => SUBGROUP_REQUEST_WGSL);
  if (swapped === shader) throw new Error('SHADOW_REQUESTS_ABSENT');
  return `enable subgroups;
diagnostic(off,subgroup_uniformity);
${swapped}`;
}
