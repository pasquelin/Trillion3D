import { KEPT_HEADER_WORDS } from '../layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../../dispatch/grid.ts'
import { ceilDiv, highHalf, lowHalf } from '../../../../../math/src/wgsl/integer.ts'

/** A region that names none: the swap kernels skip it (`../swap.ts`). */
export const REGION_NONE = 0xffff
/** The camera block's `swapRegions` word: the region saved to in its low half, the one restored
 *  from in its high half. */
export const swapRegionsWord = (save: number, back: number) => (save | (back << 16)) >>> 0

/**
 * THE DRAW MASK HANDED FROM ONE VIEW TO ANOTHER WITHOUT A CUT (#1483). A view drawn aside — a
 * capture, a persistent view — cuts on the main cut's tables (`../aside.ts`), so its mask replaces
 * the main view's. Cutting again to take it back costs a whole descent; the mask is a function of
 * the drawn journal alone (`dagClearDrawn` clears exactly those pages, `dagMask` sets exactly
 * those), so a view's mask comes back from its journal: the journal of the view leaving is saved
 * as it is cleared, and the journal of the view arriving written back with its flags.
 *
 * Each view has a region of `out` behind the kept snapshot (`savedJournalWord`): its journal's
 * length, then its pages, `listCap` at most. Which region a dispatch saves to and restores from
 * are the two halves of one word of the camera's block (`swapRegions`, `REGION_NONE` for none),
 * so one pipeline serves every region. Both dispatches are as long as their journal: the clear on the
 * journal in place (one workgroup at least, whose first thread saves its length and arms the
 * journal coming back, `armWgsl.ts`), the restore on the length its region holds.
 */
export const DAG_SWAP_WGSL = wgslBlock(
  'DAG_SWAP_WGSL',
  [ceilDiv, lowHalf, highHalf, FLAT_INDEX_WGSL, GROUP_GRID_WGSL],
  `const REGION_NONE:u32=${REGION_NONE}u;
/** Region \`v\` of \`out.pages\`: its journal's length, then its pages (\`savedJournalWord\`). */
fn savedAt(v:u32)->u32{return keptAt(${KEPT_HEADER_WORDS}u+2u*views[0u].listCap+v*(1u+views[0u].listCap));}
/** Previous frame's drawn pages, zeroed by range: the only pages whose draw flag can be one. No
 *  other is visited, and none is walked in full. The journal is saved into the region
 *  \`swapRegions\` names first on the way — its length as counted, its first \`listCap\` pages —,
 *  and the length of the one it names second armed for \`dagRestoreJournal\`. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,64u);let held=atomicLoad(&work[drawnCounter()]);
 let save=lowHalf(views[0u].swapRegions);let back=highHalf(views[0u].swapRegions);let cap=views[0u].listCap;
 if(s==0u){
  if(save!=REGION_NONE){out.pages[savedAt(save)]=held;}
  if(back!=REGION_NONE){armList(2u,min(out.pages[savedAt(back)],cap));}
 }
 if(s>=held){return;}
 let entry=flagAt(candBase()+s);
 if(save!=REGION_NONE&&s<cap){out.pages[savedAt(save)+1u+s]=entry;}
 setFlag(views[0u].queueCap+entry,0u);
}
/** The region \`swapRegions\` names second back as the drawn journal, its pages' draw flags set and its dispatch
 *  argument as its appends would leave it (\`openSlice\`): the next cut clears it as its own. The
 *  journal in place was cleared before (\`dagClearDrawn\`). */
@compute @workgroup_size(64)
fn dagRestoreJournal(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,64u);let v=highHalf(views[0u].swapRegions);
 let count=min(out.pages[savedAt(v)],views[0u].listCap);
 if(s==0u){
  let grid=select(vec2u(0u),groupGrid(ceilDiv(count,64u)),count>0u);
  atomicStore(&work[drawnCounter()],count);
  atomicStore(&work[drawnGroups()],grid.x);
  atomicStore(&work[drawnGroups()+1u],grid.y);
 }
 if(s<count){let entry=out.pages[savedAt(v)+1u+s];setFlag(views[0u].queueCap+entry,1u);setFlag(candBase()+s,entry);}
}`,
)
