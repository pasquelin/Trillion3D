import { CAND_LIVE_WORDS, LEVEL_QUEUES } from './levelWgsl.ts'
import { RAISED_PER_GROUP } from './floorWgsl.ts'
import { AHEAD_AGE } from '../evict.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { GROUP_GRID_WGSL } from '../../dispatch/grid.ts'
import { ceilDiv } from '../../../../../math/src/wgsl/integer.ts'

/**
 * Each key group's LAST USE, written by the GPU and nowhere else: the last frame a view drew a
 * cluster of the group — the nearest resident ancestor standing in for a missing page included —,
 * asked for one, or held a group it replaces (`../evict.ts`).
 *
 * The clock is the host's frame (`views[0].frame`): every view's cut of one frame — the camera's,
 * its lights', a view drawn beside it — stamps the same value, so one word says when ANY view last
 * used the group. `dagWanted` and `dagMask` raise the group of each page they ask for or draw
 * (`stampUse`), the view ahead's to an older clock (`stampAhead`); a group whose word rose is
 * listed once, and the eviction queue's workgroup raises the groups replacing it to the same clock
 * before it sweeps (`raiseParents`), round after round, each group walked by the thread whose
 * raise it was — the words are atomic, and a group the frame already reached stops the walk. So a
 * group is never older than one it replaces: the parents of a page in use are in use, up to the
 * roots, as the cut rule needs them (`readiness.ts`).
 *
 * The words live in `work` (`dagWorkLayout().lastUse`), one per group, kept from one cut to the
 * next: the eviction queue reads them (`evictWgsl.ts`). No word per page.
 *
 * `dagFlagsWords` sizes `flags`: the descent queues, `queueWords` each; the candidates, two words
 * each, and the live list, three, `candCap` of each (`levelWgsl.ts`).
 */
export const dagFlagsWords = (queueWords: number, candCap: number) =>
  queueWords * LEVEL_QUEUES + candCap * CAND_LIVE_WORDS

export const DAG_LAST_USE_WGSL = wgslBlock(
  'DAG_LAST_USE_WGSL',
  [ceilDiv, GROUP_GRID_WGSL],
  `/** Kept list \`l\`'s group count in \`work\`, x then y (0, 1), then the restored journal's (2), then
 *  the descent queues' (3 to 5, \`queueGroups\`): what the arming kernel copies (\`armWgsl.ts\`). */
fn listGroups(l:u32)->u32{return drawnGroupsMax()+1u+2u*l;}
/** The groups of a list of \`n\`, at least one, written for \`listGroups(l)\`. */
fn armList(l:u32,n:u32){let g=groupGrid(ceilDiv(max(n,1u),64u));atomicStore(&work[listGroups(l)],g.x);atomicStore(&work[listGroups(l)+1u],g.y);}
/** Group \`g\`'s last use, behind the lists' group counts. */
fn lastUseAt(g:u32)->u32{return listGroups(6u)+g;}
/** The groups this cut raised: their count, then the groups. */
fn raisedBase()->u32{return lastUseAt(views[0u].groupCount);}
fn raisedCap()->u32{return ${RAISED_PER_GROUP}u*views[0u].groupCount;}
/** The clock a use is stamped with: the host's frame. */
fn useClock()->u32{return views[0u].frame;}
/** A cut starts with no group raised (\`dagPrepare\`). */
fn clearRaised(){atomicStore(&work[raisedBase()],0u);}
/** Group \`g\` used at \`v\`: its word raised, and the group listed when it rose, for its parents. */
fn raiseUse(g:u32,v:u32){
 if(atomicMax(&work[lastUseAt(g)],v)>=v){return;}
 let at=atomicAdd(&work[raisedBase()],1u);
 if(at<raisedCap()){atomicStore(&work[raisedBase()+1u+at],g);}
}
/** Record \`r\` is used by this cut, drawn or asked for: its key's group is stamped. */
fn stampUse(r:u32){raiseUse(groupOfKey(keyOf(r)),useClock());}
/** Record \`r\` is asked for by the view ahead: stamped as used \`AHEAD_AGE\` frames ago. */
fn stampAhead(r:u32){let now=useClock();raiseUse(groupOfKey(keyOf(r)),max(now,${AHEAD_AGE}u)-${AHEAD_AGE}u);}
/** The round of raised groups being walked: \`[x, y)\` of the list. */
var<workgroup> raiseRound:vec2u;
/** The groups replacing each raised group raised to its clock, round after round, until a round
 *  raises none: the workgroup of the eviction queue, before it sweeps (\`evictWgsl.ts\`), as many
 *  rounds as the levels a raise climbs. */
fn raiseParents(lane:u32){
 if(lane==0u){raiseRound=vec2u(0u,min(atomicLoad(&work[raisedBase()]),raisedCap()));}
 loop{
  let round=workgroupUniformLoad(&raiseRound);
  if(round.x>=round.y){break;}
  for(var i=round.x+lane;i<round.y;i+=SORT_LANES){
   let g=atomicLoad(&work[raisedBase()+1u+i]);let v=atomicLoad(&work[lastUseAt(g)]);
   let end=groupParentStart(g+1u);
   for(var p=groupParentStart(g);p<end;p++){raiseUse(groupParentAt(p),v);}
  }
  storageBarrier();
  workgroupBarrier();
  if(lane==0u){raiseRound=vec2u(round.y,min(atomicLoad(&work[raisedBase()]),raisedCap()));}
 }
 storageBarrier();
}
`,
)
