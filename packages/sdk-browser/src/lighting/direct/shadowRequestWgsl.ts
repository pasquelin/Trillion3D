import {
  PAGE_FOOTPRINT_EDGE_BITS,
  PAGE_FOOTPRINT_STEP,
  SHADOW_REQUEST_MISS,
} from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import {
  SUN_WINDOW,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Words of one bit per table entry of a session's window. */
const shadowEntryBits = (pages = SUN_WINDOW) => shadowTableEntries(pages) / 32;
/** Words of the request buffer after the count and a list as long as the pool's (`shadowRequestCap`,
 *  read at run time): one bit per table entry — a page is listed once however many pixels read it
 *  —, then one per entry for its miss (#1211), listed once the same way. */
export const shadowRequestBits = (pages = SUN_WINDOW) => 2 * shadowEntryBits(pages);
/** Words of the cell table of a list of `cap` (#1211): its overflow word, then `2 · cap` slots of
 *  a key — the entry plus one, zero while free — and the mask of the cells read of that page. */
export const shadowCellWords = (cap: number) => 1 + 4 * cap;
/** Words of the whole request buffer of a list of `cap`: count, list, bits and cell table. */
export const shadowRequestWords = (cap: number, pages = SUN_WINDOW) =>
  1 + cap + shadowRequestBits(pages) + shadowCellWords(cap);
/** Probes a mark tries in the cell table before it says the table overflowed. */
const CELL_PROBES = 32;
/** Cells a side of a page, `PAGE_FOOTPRINT_STEP` texels each (`cellsFootprint`). */
const CELLS = 2 ** PAGE_FOOTPRINT_EDGE_BITS;
/** The receiver's cell of the page-local texel `l` (#1211): which of the 4×4 `PAGE_FOOTPRINT_STEP`
 *  texel cells it lies in, row by row from zero — its bit in a page's cell mask. */
const SHADOW_REQUEST_CELL_WGSL = `fn shadowRequestCell(l:vec2f)->u32{
 return min(u32(l.x/${PAGE_FOOTPRINT_STEP}.0),${CELLS - 1}u)+${CELLS}u*min(u32(l.y/${PAGE_FOOTPRINT_STEP}.0),${CELLS - 1}u);
}`;

/** The list's capacity, from the buffer's length (`shadowRequestWords`). */
const capWgsl = (entryBits: number) =>
  `let cap=(arrayLength(&shadowRequests)-${2 + 2 * entryBits}u)/5u;`;

/** The claim of page `e` by one lane: its bit tested before the atomic, then set, and the page
 *  listed by whoever set it first — so a page thousands of pixels read costs one list slot. A
 *  miss claims its own bit and lists its entry flagged (`SHADOW_REQUEST_MISS`). */
const claimWgsl = (name: string, entryBits: number, miss = false) => `fn ${name}(e:u32){
 ${capWgsl(entryBits)}let word=1u+cap+${miss ? `${entryBits}u+` : ''}(e>>5u);let bit=1u<<(e&31u);
 if((atomicLoad(&shadowRequests[word])&bit)!=0u){return;}
 if((atomicOr(&shadowRequests[word],bit)&bit)!=0u){return;}
 let at=atomicAdd(&shadowRequests[0],1u);
 if(at<cap){atomicStore(&shadowRequests[1u+at],e${miss ? `|${SHADOW_REQUEST_MISS}u` : ''});}
}`;

/**
 * The cell table (#1211): cell `cell` of page `e` set in the page's mask by `atomicOr`, whichever
 * lane reads it — the claim above lists a page once, so the cells ride apart, every one of them.
 * The page's slot is found by linear probing from a hash of `e`, taken by a compare-exchange;
 * past `CELL_PROBES` the mark sets the overflow word, and the frame's masks are partial.
 */
const cellMarkWgsl = (entryBits: number) => `fn markShadowCell(e:u32,cell:u32){
 ${capWgsl(entryBits)}let cells=1u+cap+${2 * entryBits}u;let slots=2u*cap;
 if(slots==0u){atomicStore(&shadowRequests[cells],1u);return;}
 let key=e+1u;var h=(e^(e>>9u)^(e>>17u))%slots;
 for(var probe=0u;probe<${CELL_PROBES}u;probe++){
  let at=cells+1u+2u*h;
  var held=atomicLoad(&shadowRequests[at]);
  if(held==0u){
   let taken=atomicCompareExchangeWeak(&shadowRequests[at],0u,key);
   held=select(taken.old_value,key,taken.exchanged);
  }
  // Tested before the atomic, as the claim: most pixels read a cell already set.
  if(held==key){if((atomicLoad(&shadowRequests[at+1u])&(1u<<cell))==0u){atomicOr(&shadowRequests[at+1u],1u<<cell);}return;}
  if(held!=0u){h=select(h+1u,0u,h+1u==slots);}
 }
 atomicStore(&shadowRequests[cells],1u);
}`;

/** The per-lane request, every device's: each lane claims its own page. The fallback of
 *  `SUBGROUP_REQUEST_WGSL`, and the text `withSubgroupShadowRequests` replaces. */
const laneRequestWgsl = (pages = SUN_WINDOW) =>
  claimWgsl('requestShadowPage', shadowEntryBits(pages));
export const LANE_REQUEST_WGSL = laneRequestWgsl();
/** The per-pixel demand's request (`demandWgsl.ts`) and a reader's miss (`shadowPageWgsl.ts`):
 *  the page claimed as any, and the cell of the texel read set in its mask — how a page's
 *  footprint is fed (#1211): the union of every cell read, never the first lane's alone. */
const cellRequestWgsl = (pages = SUN_WINDOW) => `${cellMarkWgsl(shadowEntryBits(pages))}
${claimWgsl('shadowClaimMarked', shadowEntryBits(pages))}
${claimWgsl('shadowClaimMiss', shadowEntryBits(pages), true)}
fn requestShadowPageAt(e:u32,cell:u32){shadowClaimMarked(e);markShadowCell(e,cell);}
fn requestShadowMiss(e:u32,cell:u32){shadowClaimMiss(e);markShadowCell(e,cell);}`;

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
const subgroupRequestWgsl = (pages = SUN_WINDOW) =>
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
export const SUBGROUP_REQUEST_WGSL = subgroupRequestWgsl();

/**
 * What a reading asks of the scheduler. The shading that marks writes the page into the request
 * buffer the first time any pixel reads it this frame, a bit per table entry, and, apart, a page
 * it found drawn for a footprint that misses its texel (`requestShadowMiss`, per lane: a miss is
 * rare and brief); the demand's marks and the misses set the cell they read in the cell table. A
 * pass that does not mark — the blend and water stages, which keep their early depth reject —
 * reads without asking, and the frame says it lit them (`demandFootprint.ts`). `shadowRequesting`
 * is the pass's to set on a lane that asks per subgroup.
 */
export const shadowRequestWgsl = (binding: number | null, pages = SUN_WINDOW) =>
  binding === null
    ? `${SHADOW_REQUEST_CELL_WGSL}\nfn requestShadowPage(e:u32){}\nfn requestShadowPageAt(e:u32,cell:u32){}\nfn requestShadowMiss(e:u32,cell:u32){}`
    : `@group(0) @binding(${binding}) var<storage,read_write> shadowRequests:array<atomic<u32>>;
var<private> shadowRequesting:bool=false;
${SHADOW_REQUEST_CELL_WGSL}
${laneRequestWgsl(pages)}
${cellRequestWgsl(pages)}`;

/**
 * `shader`, a text that asks with `LANE_REQUEST_WGSL`, asking per subgroup instead: the feature
 * enabled, and the uniformity diagnostic off — the request runs in the pixel's own control flow,
 * and the loop above holds for any set of active lanes.
 */
export function withSubgroupShadowRequests(shader: string, pages = SUN_WINDOW) {
  const swapped = shader.replace(laneRequestWgsl(pages), () => subgroupRequestWgsl(pages));
  if (swapped === shader) throw new Error('SHADOW_REQUESTS_ABSENT');
  return `enable subgroups;
diagnostic(off,subgroup_uniformity);
${swapped}`;
}
