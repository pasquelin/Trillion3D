import { VIEW_BLOCK_WORDS } from '../viewLayout.ts'
import { AHEAD_VIEW } from './aheadWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

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
 * The array holds the views a cut runs: the camera's, and the view ahead of it (`AHEAD_VIEW`).
 * `uniforms.ts` writes `viewCount` 1 and nothing else indexes a view; the shader still carries the
 * entry's view bits, as the view ahead is the one view past the camera's.
 */
const DAG_MAX_VIEWS = AHEAD_VIEW + 1
/** Bits below the view index in a work entry: 2^27 nodes or clusters, five bits of view. */
const VIEW_SHIFT = 27
if (DAG_MAX_VIEWS > 1 << (32 - VIEW_SHIFT))
  throw new Error(`${DAG_MAX_VIEWS} views do not fit the ${32 - VIEW_SHIFT} view bits`)

/**
 * Words of one view's uniform block: the uniform array's stride (`shader.ts`, `Uniforms`).
 *
 * It is the field table's own size (`../viewLayout.ts`), so a field added to the block moves the
 * stride with it.
 */
export const DAG_VIEW_WORDS = VIEW_BLOCK_WORDS
/** Bytes of the uniform array a cut binds: every view's block, whatever the views it runs. */
export const DAG_UNIFORM_BYTES = DAG_MAX_VIEWS * DAG_VIEW_WORDS * 4
/** Per-view words behind `work`'s frame counters, one row of `viewCapacity` each — live count,
 *  live offset, drawn count —, then one word: zeroed by `dagPrepare`, read by no kernel since the
 *  cut runs one view; the frame count lies behind them (`dagWorkLayout`). */
export const VIEW_WORD_ROWS = 3
/**
 * Bit of the output's flag word set when a queue or a list was full and work was dropped: each
 * list holds the whole catalogue, each queue every node and one root per slot.
 */
const WORK_DROPPED = 4

export const DAG_VIEWS_WGSL = wgslBlock(
  'DAG_VIEWS_WGSL',
  [],
  `const MAX_VIEWS:u32=${DAG_MAX_VIEWS}u;
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
`,
)
