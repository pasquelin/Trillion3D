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

/**
 * The request per subgroup (OMB-21, #966), when the device granted `subgroups`: the active lanes
 * take their pages in turn, the first lane's page, then the next one left, and one lane of those
 * that ask for it claims it — one claim, hence one global atomic, per distinct page and subgroup
 * where each lane made its own. A claim is idempotent, so the bits set, the count and the pages
 * listed are those of `LANE_REQUEST_WGSL` (the list's order is free). Every lane leaves in the
 * round of its own page, which the first active lane always holds: the loop ends in at most one
 * round per lane, whatever the device reconverges.
 *
 * A lane that must not ask (`shadowRequesting` false: a helper invocation, whose atomics touch
 * nothing) leaves first, so it is never elected in place of a pixel that asks for its page.
 */
const SUBGROUP_REQUEST_WGSL = `${claimWgsl('shadowClaimPage')}
fn requestShadowPage(e:u32){
 if(!shadowRequesting){return;}
 loop{
  let first=subgroupBroadcastFirst(e);
  if(e==first){
   if(subgroupElect()){shadowClaimPage(e);}
   return;
  }
 }
}`;

/**
 * What a reading asks of the scheduler. The shading that marks writes the page into the request
 * buffer the first time any pixel reads it this frame, a bit per table entry. A pass that does
 * not mark — the blend forward stage, which keeps its early depth reject — reads without asking.
 * `shadowRequesting` is the pass's to clear on a lane that must not ask.
 */
export const shadowRequestWgsl = (binding: number | null) =>
  binding === null
    ? 'fn requestShadowPage(e:u32){}'
    : `@group(0) @binding(${binding}) var<storage,read_write> shadowRequests:array<atomic<u32>>;
var<private> shadowRequesting:bool=true;
${LANE_REQUEST_WGSL}`;

/**
 * `shader`, a text that asks with `LANE_REQUEST_WGSL`, asking per subgroup instead: the feature
 * enabled, and the uniformity diagnostic off — the request runs in the pixel's own control flow,
 * and the loop above holds for any set of active lanes.
 */
export function withSubgroupShadowRequests(shader: string) {
  if (!shader.includes(LANE_REQUEST_WGSL)) throw new Error('SHADOW_REQUESTS_ABSENT');
  return `enable subgroups;
diagnostic(off,subgroup_uniformity);
${shader.replace(LANE_REQUEST_WGSL, () => SUBGROUP_REQUEST_WGSL)}`;
}
