import { MAX_SHADOW_PAGES } from '../../shadow/recordPack.ts';

/**
 * ONE cut, many views: the frame's shadow views — sun clipmap levels and lamp faces that have
 * pages to draw — are selected by a single traversal of the DAG kernels, not one traversal each.
 *
 * Each work item carries the index of the view it serves: a descent-queue entry, a candidate page
 * and a live cluster pack it in their top bits (`VIEW_SHIFT`). Each view reads its own block of the
 * uniform array — planes, projection, page mask, texel error — and owns its per-primitive
 * frustum planes, indexed by the SLOT `view * worldCount + world`. Nothing carries from one frame
 * to the next. What the views share is what one cut shares: the clusters, the hierarchy, the
 * residency bits, the queues and lists, and the request readback.
 *
 * A dispatch waits for the previous one whatever its size (`../encode.ts`): V views run as V
 * traversals paid V times that wait, and as one traversal pay it once. The thread count is the
 * same — each level still visits, per view, what its bound allows.
 *
 * A camera is the one-view case: view 0, slot = primitive, entries equal to the bare indices. Its
 * text, its layout and its verdicts are those of before.
 *
 * The view count is bounded by what a batch can draw: every view a batch draws holds at least one
 * of its pages, and a batch draws at most `MAX_SHADOW_PAGES` pages — the one capacity both read.
 */
export const DAG_MAX_VIEWS = MAX_SHADOW_PAGES;
/** Bits below the view index in a work entry: 2^27 nodes or clusters, five bits of view. */
const VIEW_SHIFT = 27;
if (DAG_MAX_VIEWS > 1 << (32 - VIEW_SHIFT))
  throw new Error(`${DAG_MAX_VIEWS} views do not fit the ${32 - VIEW_SHIFT} view bits`);

export { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from '../../shadow/sizes.ts';
/** Per-view words behind `work`'s frame counters, one row of `viewCapacity` each: live count,
 *  live offset, drawn count; then one word, the most sixty-four-wide groups any view drew — the
 *  width of the shadow cull that reads every view's log in one dispatch (`dagWorkLayout`). */
export const VIEW_WORD_ROWS = 3;
/**
 * Bit of the output's flag word set when a queue or a list was full and work was dropped. The
 * views of a light cut share the camera cut's capacities — each list holds the whole catalogue,
 * each queue every node and one root per slot —, a fixed budget whatever the view count: no view
 * alone can fill them, and several can only by together keeping more than the catalogue.
 */
export const WORK_DROPPED = 4;
/** Bit of the same word set once the request list is full (`snapshotWgsl.ts`): what was appended
 *  past it was never copied. A later batch of the frame keeps it (`VIEW_APPEND`). */
export const LIST_FULL = 1;
/** Bit `COARSER_VIEWS + view` of the same word is set when light view `view` wanted a cluster that
 *  is not resident, and drew its nearest resident ancestor (`noteCoarser`): the pages of that view,
 *  and only those, wait for residency to change. */
export const COARSER_VIEWS = 8;
if (COARSER_VIEWS + DAG_MAX_VIEWS > 32)
  throw new Error(`${DAG_MAX_VIEWS} views do not fit the flag word's coarser-view bits`);

export const DAG_VIEWS_WGSL = `const MAX_VIEWS:u32=${DAG_MAX_VIEWS}u;
const VIEW_SHIFT:u32=${VIEW_SHIFT}u;
const ENTRY_INDEX:u32=${(1 << VIEW_SHIFT) - 1}u;
/** The view the current work item serves: set by each kernel from its entry, read by every
 *  function that needs a view's uniforms. A camera leaves it at zero. */
var<private> vi:u32;
fn packEntry(view:u32,index:u32)->u32{return (view<<VIEW_SHIFT)|index;}
fn entryIndex(entry:u32)->u32{return entry&ENTRY_INDEX;}
fn entryView(entry:u32)->u32{return entry>>VIEW_SHIFT;}
/** Per-primitive frustum planes: one row of the range's primitives per view. */
fn slotOf(w:u32)->u32{return vi*rangeCount()+rowOf(w);}
/** A table split in ranges (\`../frameRanges.ts\`): each dispatch binds one, \`range\`, and a kernel
 *  that reads a primitive's words leaves another range's to that range's dispatch. False on a
 *  table the device holds whole: each helper below is then the identity of before. */
override SPLIT:bool=false;
fn rangeFirst()->u32{if(SPLIT){return range.first;}return 0u;}
fn rangeCount()->u32{if(SPLIT){return range.count;}return views[0u].worldCount;}
/** Primitive \`w\`'s row in the bound \`frames\`, and whether its range is the bound one. */
fn rowOf(w:u32)->u32{return w-rangeFirst();}
fn inRange(w:u32)->bool{return !SPLIT||rowOf(w)<range.count;}
/** Slot \`i\` of a range's dispatch, view after view, among the whole table's slots. */
fn rangeSlot(i:u32)->u32{if(!SPLIT){return i;}let v=i/range.count;return v*views[0u].worldCount+range.first+i-v*range.count;}
/** Row \`row\` of the per-view words, for view \`v\` (\`VIEW_WORD_ROWS\`). */
fn viewWord(row:u32,v:u32)->u32{return extraBase()+row*views[0u].viewCapacity+v;}
/** The word behind the per-view rows: the most sixty-four-wide groups any view drew. */
fn drawnGroupsMax()->u32{return viewWord(${VIEW_WORD_ROWS}u,0u);}
fn dropWork(){atomicOr(&out.overflow,${WORK_DROPPED}u);}
fn noteCoarser(){if(isLightCut()){atomicOr(&out.overflow,1u<<(${COARSER_VIEWS}u+vi));}}
fn isLightCut()->bool{return (views[0u].viewFlags&VIEW_LIGHT)!=0u;}
/** A drawn cluster of the current view, appended at its view's own range of the drawn log — the
 *  candidate list's words, free once \`dagWanted\` has read them. Opening a sixty-four slice
 *  raises the widest view's group count. */
fn viewDrawnAppend(i:u32){
 let r=atomicAdd(&work[viewWord(2u,vi)],1u);
 setFlag(candBase()+atomicLoad(&work[viewWord(1u,vi)])+r,i);
 if((r&63u)==0u){atomicMax(&work[drawnGroupsMax()],(r>>6u)+1u);}
}
/** Each view's share of the drawn log starts at the live clusters of the views before it: a view
 *  draws at most what it keeps live, so the ranges never overlap and all fit the list. */
@compute @workgroup_size(1)
fn dagViewOffsets(){
 var at=0u;
 for(var v=0u;v<views[0u].viewCount;v++){
  atomicStore(&work[viewWord(1u,v)],at);
  at=at+atomicLoad(&work[viewWord(0u,v)]);
 }
}
`;
