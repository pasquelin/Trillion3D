import { EVICTION_BURST } from '../readoutWords.ts'
import { ADMISSION_BUCKETS } from '../request.ts'
import { KEPT_HEADER_WORDS } from '../layout.ts'
import { KEPT_RANK_HEAD } from '../keptRanks.ts'
import { SELECTION_NONE, SELECTION_WORKGROUP } from '../../core/selection.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { mixWord } from '../../../../../math/src/wgsl/sampling.ts'
import { FLAT_INDEX_WGSL } from '../../dispatch/grid.ts'

/**
 * THE CUT AS A DIFFERENCE, taken where the cut is: for each rank of a copied snapshot's two lists,
 * the rank its page held in the snapshot copied before — none when the page was not there.
 *
 * The host adopts some snapshots and not others; every copy lands in order, and its ranks are
 * carried to the list the host holds (`../differenceChain.ts`), so pages it names by a rank are
 * never looked up by id (`../../../webgpu/cut/claimedDifference.ts`). Ranks only: a kept rank no
 * rank names left, and the host reads that off the ranks it held, so no row of exits is written.
 *
 * The kept snapshot sits behind the staged requests, outside what the frame copies: its two lengths,
 * then the requests' pages and the drawn pages, a list each. Beside it, for each list, a table of
 * the kept pages' ranks (`../keptRanks.ts`): open-addressed by page, twice the list's cap in slots
 * at least, so its load stays under one half — the readout's bound, never the catalogue's. Each
 * list's table is a buffer of its own, which its kernels bind where the cut binds `work`
 * (`../listCap.ts`, `rankGroups`), so no stage binds one buffer more. A slot is three words: the
 * keep that wrote it, the page, the rank. A keep stamps its slots with a generation one past the
 * table's, so the slots of every keep before it read as empty and no table is ever cleared; the
 * difference before it names that generation (`KEPT_NEXT`), the keep makes it the table's
 * (`KEPT_GEN`). A rank found is believed only where the kept list holds the page there, so a kept
 * list cut short by the cap names exactly what it holds.
 *
 * `dagCutDifference` and `dagCutKeep` run only in a dispatch that copies a snapshot, both lists'
 * differences before either is kept (`../encode.ts`), so the kept one is always the last snapshot
 * COPIED, and the readbacks land in the order they were copied: each difference is taken against
 * the readback before it. A buffer just made keeps empty lists.
 */
/** The kernels of each kept list, the camera's requests then the drawn pages. */
export const DIFFERENCE_STAGES = ['dagCutDifference0', 'dagCutDifference1'] as const,
  KEEP_STAGES = ['dagCutKeep0', 'dagCutKeep1'] as const,
  REKEEP_STAGES = ['dagCutRekeep0', 'dagCutRekeep1'] as const

export const DAG_DIFFERENCE_WGSL = wgslBlock(
  'DAG_DIFFERENCE_WGSL',
  [FLAT_INDEX_WGSL, mixWord],
  `const RANK_NONE:u32=${SELECTION_NONE}u;
/** Admission bucket \`b\`'s count of the camera's requests in \`out.pages\`, behind the eviction
 *  burst (\`levelCountsWord\`). */
fn levelCountAt(b:u32)->u32{return 2u*views[0u].listCap+2u*HEAD+${EVICTION_BURST}u+b;}
/** Word \`k\` of the difference in \`out.pages\`, behind the level counts (\`differenceWord\`). */
fn differenceAt(k:u32)->u32{return levelCountAt(${ADMISSION_BUCKETS}u+k);}
/** List \`l\`'s difference (0 the camera's requests, 1 the drawn pages): the rank each of its pages
 *  held in the kept list. */
fn fromAt(l:u32,s:u32)->u32{return differenceAt(l*views[0u].listCap+s);}
/** Word \`k\` of the kept snapshot in \`out.pages\`, behind the staged requests ahead, two words
 *  each (\`keptSnapshotWord\`): the two lengths, then the requests' pages, then the drawn pages, a
 *  word each. */
fn keptAt(k:u32)->u32{return aheadStagedAt(aheadCap())+k;}
fn keptPage(l:u32,s:u32)->u32{return keptAt(${KEPT_HEADER_WORDS}u+l*views[0u].listCap+s);}
/** List \`l\` as long as the host reads it, and its page at rank \`s\`: the camera's requests, the
 *  drawn pages. */
fn listCount(l:u32)->u32{
 if(l==0u){return min(atomicLoad(&out.count),views[0u].listCap);}
 return min(out.pages[views[0u].listCap],views[0u].listCap);
}
fn listPage(l:u32,s:u32)->u32{
 if(l==0u){return out.pages[s];}
 return out.pages[views[0u].listCap+HEAD+s];
}
/** The table's generation, the one its next keep stamps, and its first slot (\`../keptRanks.ts\`). */
const KEPT_GEN:u32=0u;
const KEPT_NEXT:u32=1u;
const KEPT_HEAD:u32=${KEPT_RANK_HEAD}u;
/** Slots of a list's table: twice the cap, rounded up to a power of two (\`halfLoadSlots\`). */
fn keptSlots()->u32{return 1u<<(32u-countLeadingZeros(2u*max(views[0u].listCap,1u)-1u));}
fn keptHome(i:u32)->u32{return mixWord(i)&(keptSlots()-1u);}
/** The rank page \`i\` holds in kept list \`l\`, or none: probed in the list's table, bound as
 *  \`work\`, from the page's home to the first slot no keep of this generation wrote. A page
 *  repeated in the list is found at one of its ranks. */
fn keptRankOf(l:u32,i:u32)->u32{
 let gen=atomicLoad(&work[KEPT_GEN]);
 if(gen==0u){return RANK_NONE;}
 let mask=keptSlots()-1u;
 var s=keptHome(i);
 for(var k=0u;k<=mask;k++){
  let at=KEPT_HEAD+3u*s;
  if(atomicLoad(&work[at])!=gen){return RANK_NONE;}
  let r=atomicLoad(&work[at+2u]);
  if(atomicLoad(&work[at+1u])==i&&r<out.pages[keptAt(l)]&&out.pages[keptPage(l,r)]==i){return r;}
  s=(s+1u)&mask;
 }
 return RANK_NONE;
}
/** Page \`i\` at rank \`r\` in the table, stamped \`gen\`: the first slot from its home no keep of
 *  \`gen\` holds, taken by exchange — a lookup walks the same slots and stops past it. */
fn keepRank(i:u32,r:u32,gen:u32){
 let mask=keptSlots()-1u;
 var s=keptHome(i);
 for(var k=0u;k<=mask;k++){
  let at=KEPT_HEAD+3u*s;
  loop{
   let old=atomicLoad(&work[at]);
   if(old==gen){break;}
   if(atomicCompareExchangeWeak(&work[at],old,gen).exchanged){atomicStore(&work[at+1u],i);atomicStore(&work[at+2u],r);return;}
  }
  s=(s+1u)&mask;
 }
}
${[0, 1].map(listKernels).join('')}`,
)

/** List \`l\`'s kernels, its table bound as \`work\`: one thread per rank of the list, its first
 *  thread whatever the length (\`armList\`). */
function listKernels(l: number) {
  return `/** List ${l}: each rank's page, its rank in the kept list; the next keep's generation named. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${DIFFERENCE_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,${SELECTION_WORKGROUP}u);
 if(s==0u){atomicStore(&work[KEPT_NEXT],atomicLoad(&work[KEPT_GEN])+1u);}
 if(s<listCount(${l}u)){out.pages[fromAt(${l}u,s)]=keptRankOf(${l}u,listPage(${l}u,s));}
}
/** List ${l} of this snapshot becomes the kept one: its pages, the rank of each, its length. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${KEEP_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,${SELECTION_WORKGROUP}u);let gen=atomicLoad(&work[KEPT_NEXT]);
 if(s<listCount(${l}u)){let page=listPage(${l}u,s);out.pages[keptPage(${l}u,s)]=page;keepRank(page,s,gen);}
 if(s==0u){out.pages[keptAt(${l}u)]=listCount(${l}u);atomicStore(&work[KEPT_GEN],gen);}
}
/** Kept list ${l}, carried into a readout made again, ranked in its new, empty table
 *  (\`../listCap.ts\`). */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${REKEEP_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,${SELECTION_WORKGROUP}u);
 if(s<out.pages[keptAt(${l}u)]){keepRank(out.pages[keptPage(${l}u,s)],s,1u);}
 if(s==0u){atomicStore(&work[KEPT_GEN],1u);}
}
`
}
