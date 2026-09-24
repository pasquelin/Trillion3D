import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/index.ts';

/**
 * ONE cut, many views: the frame's shadow views — sun clipmap levels and lamp faces that have
 * pages to draw — are selected by a single traversal of the DAG kernels, not one traversal each.
 *
 * Each work item carries the index of the view it serves: a descent-queue entry, a candidate page
 * and a live cluster pack it in their top bits (`VIEW_SHIFT`). Each view reads its own block of the
 * uniform array — planes, projection, page mask, texel error — and owns its own per-primitive
 * state: threshold, pinned fallback, pruning words and per-primitive frustum planes are indexed by
 * the SLOT `view * worldCount + world`, not the primitive. What the views share is what one cut
 * shares: the clusters, the hierarchy, the residency bits, the queues and lists, and the request
 * readback.
 *
 * A dispatch waits for the previous one whatever its size (`../encode.ts`): V views run as V
 * traversals paid V times that wait, and as one traversal pay it once. The thread count is the
 * same — each level still visits, per view, what its bound allows.
 *
 * A camera is the one-view case: view 0, slot = primitive, entries equal to the bare indices. Its
 * text, its layout and its verdicts are those of before.
 *
 * The view count is bounded by what a frame can draw: every view drawn this frame holds at least
 * one of its pages, and a frame draws at most `shadowPagesPerFrame` pages.
 */
export const DAG_MAX_VIEWS: number = LIGHT_SETTINGS.shadowPagesPerFrame;
/** Bits below the view index in a work entry: 2^27 nodes or clusters, five bits of view. */
const VIEW_SHIFT = 27;
if (DAG_MAX_VIEWS > 1 << (32 - VIEW_SHIFT))
  throw new Error(`${DAG_MAX_VIEWS} views do not fit the ${32 - VIEW_SHIFT} view bits`);

/** Words of one view's uniform block: the uniform array's stride (`shader.ts`, `Uniforms`). */
export const DAG_VIEW_WORDS = 64;
/** Bytes of the uniform array a cut binds: every view's block, whatever the views it runs. */
export const DAG_UNIFORM_BYTES = DAG_MAX_VIEWS * DAG_VIEW_WORDS * 4;
/** Per-view words behind `work`'s pruning words, one row of `viewCapacity` each: live count,
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
/** Bit of the same word set when a light view drew a primitive coarser than it wanted, its
 *  cluster not resident (`escalate`): the pages it drew wait for residency to change. */
export const WORK_ESCALATED = 8;

export const DAG_VIEWS_WGSL = `const MAX_VIEWS:u32=${DAG_MAX_VIEWS}u;
const VIEW_SHIFT:u32=${VIEW_SHIFT}u;
const ENTRY_INDEX:u32=${(1 << VIEW_SHIFT) - 1}u;
/** The view the current work item serves: set by each kernel from its entry, read by every
 *  function that needs a view's uniforms. A camera leaves it at zero. */
var<private> vi:u32;
fn packEntry(view:u32,index:u32)->u32{return (view<<VIEW_SHIFT)|index;}
fn entryIndex(entry:u32)->u32{return entry&ENTRY_INDEX;}
fn entryView(entry:u32)->u32{return entry>>VIEW_SHIFT;}
/** Per-primitive state slots: one row of \`worldCount\` per view the buffers were sized for. */
fn slots()->u32{return views[0u].worldCount*views[0u].viewCapacity;}
fn slotOf(w:u32)->u32{return vi*views[0u].worldCount+w;}
/** Row \`row\` of the per-view words, for view \`v\` (\`VIEW_WORD_ROWS\`). */
fn viewWord(row:u32,v:u32)->u32{return extraBase()+slots()*2u+row*views[0u].viewCapacity+v;}
/** The word behind the per-view rows: the most sixty-four-wide groups any view drew. */
fn drawnGroupsMax()->u32{return viewWord(${VIEW_WORD_ROWS}u,0u);}
fn dropWork(){atomicOr(&out.overflow,${WORK_DROPPED}u);}
fn noteEscalation(){if(isLightCut()){atomicOr(&out.overflow,${WORK_ESCALATED}u);}}
fn isLightCut()->bool{return (views[0u].viewFlags&VIEW_LIGHT)!=0u;}
/** A drawn cluster of the current view, appended at its view's own range of the drawn log — the
 *  candidate list's words, free once \`dagWanted\` has read them. Opening a sixty-four slice
 *  raises the widest view's group count. */
fn viewDrawnAppend(i:u32){
 let r=atomicAdd(&work[viewWord(2u,vi)],1u);
 flags[candBase()+atomicLoad(&work[viewWord(1u,vi)])+r]=i;
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
