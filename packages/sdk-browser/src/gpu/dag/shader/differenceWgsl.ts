import { EVICTION_BURST } from '../readoutWords.ts'
import { ADMISSION_BUCKETS } from '../request.ts'
import { KEPT_HEADER_WORDS } from '../layout.ts'
import { SELECTION_NONE, SELECTION_WORKGROUP } from '../../core/selection.ts'

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
 * then the requests' pages and the drawn pages, a list each. Beside it, for each list, a word a
 * page: the rank `dagCutKeep` last wrote for it. Each list's words are a buffer of their own, a
 * page's word at the page's index, which its kernels bind where the cut binds `work`
 * (`../resources.ts`, `rankGroups`): a list a kernel, so one binding holds the ranks of as many
 * pages as it holds draw flags, and no stage binds one buffer more. That word is believed only
 * where the kept list still holds the page at that rank, so no mask of the kept pages is kept nor
 * cleared, and a kept list cut short by the cap names exactly what it holds.
 *
 * `dagCutDifference` and `dagCutKeep` run only in a dispatch that copies a snapshot, both lists'
 * differences before either is kept (`../encode.ts`), so the kept one is always the last snapshot
 * COPIED, and the readbacks land in the order they were copied: each difference is taken against
 * the readback before it. A buffer just made keeps empty lists.
 */
/** The kernels of each kept list, the camera's requests then the drawn pages. */
export const DIFFERENCE_STAGES = ['dagCutDifference0', 'dagCutDifference1'] as const,
  KEEP_STAGES = ['dagCutKeep0', 'dagCutKeep1'] as const

export const DAG_DIFFERENCE_WGSL = `const RANK_NONE:u32=${SELECTION_NONE}u;
/** Admission bucket \`b\`'s count of the camera's requests in \`out.pages\`, behind the eviction
 *  burst (\`levelCountsWord\`). */
fn levelCountAt(b:u32)->u32{return 2u*views[0u].listCap+2u*HEAD+${EVICTION_BURST}u+b;}
/** Word \`k\` of the difference in \`out.pages\`, behind the level counts (\`differenceWord\`). */
fn differenceAt(k:u32)->u32{return levelCountAt(${ADMISSION_BUCKETS}u+k);}
/** List \`l\`'s difference (0 the camera's requests, 1 the drawn pages): the rank each of its pages
 *  held in the kept list. */
fn fromAt(l:u32,s:u32)->u32{return differenceAt(l*views[0u].listCap+s);}
/** Word \`k\` of the kept snapshot in \`out.pages\`, behind the staged requests ahead
 *  (\`keptSnapshotWord\`): the two lengths, then the requests' pages, then the drawn pages. */
fn keptAt(k:u32)->u32{return aheadStagedAt(aheadCap()+k);}
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
/** The rank page \`i\` holds in kept list \`l\`, or none: the rank last written for it — in the
 *  list's own words, bound as \`work\` —, when the kept list holds the page there. A page repeated
 *  in the list is found at one of its ranks. */
fn keptRankOf(l:u32,i:u32)->u32{
 let r=atomicLoad(&work[i]);
 if(r<out.pages[keptAt(l)]&&out.pages[keptPage(l,r)]==i){return r;}
 return RANK_NONE;
}
${[0, 1].map(listKernels).join('')}`

/** List \`l\`'s two kernels, its ranks bound as \`work\`: one thread per rank of the list. */
function listKernels(l: number) {
  return `/** List ${l}: each rank's page, its rank in the kept list. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${DIFFERENCE_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 if(s<listCount(${l}u)){out.pages[fromAt(${l}u,s)]=keptRankOf(${l}u,listPage(${l}u,s));}
}
/** List ${l} of this snapshot becomes the kept one: its pages, the rank of each, its length. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${KEEP_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 if(s<listCount(${l}u)){let page=listPage(${l}u,s);out.pages[keptPage(${l}u,s)]=page;atomicStore(&work[page],s);}
 if(s==0u){out.pages[keptAt(${l}u)]=listCount(${l}u);}
}
`
}
