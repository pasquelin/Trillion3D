import { DIFFERENCE_HEADER_WORDS, EVICTION_BURST } from '../readoutWords.ts'
import { ADMISSION_BUCKETS } from '../request.ts'
import { KEPT_HEADER_WORDS } from '../layout.ts'
import { SELECTION_NONE, SELECTION_WORKGROUP } from '../../core/selection.ts'

/**
 * THE CUT AS A DIFFERENCE, taken where the cut is: for each of a copied snapshot's two lists, the
 * pages that entered since the snapshot copied before, and the pages that left it.
 *
 * The host adopts some snapshots and not others; every copy lands in order, and its differences
 * are composed through the snapshots since the list the host holds (`../differenceChain.ts`), so the
 * host reads what changed alone, never the lists (`../../../webgpu/cut/delta.ts`, `applyNet`).
 *
 * The kept snapshot sits behind the staged requests, outside what the frame copies: its two lengths,
 * then the requests' pages and the drawn pages, a list each. Beside it, for each list, a word a
 * page: the rank `dagCutKeep` last wrote for it — believed only where the kept list still holds the
 * page at that rank —, then the list's two counters and a bit per kept rank, claimed by a page of
 * the snapshot (`claimedWord`). Each list's words are a buffer of their own, which its kernels bind
 * where the cut binds `work` (`../resources.ts`, `rankGroups`).
 *
 * Per list: `dagCutDifference` names each page with no kept rank an entry and claims the kept rank
 * of every other; `dagCutExit` names each kept rank no page claimed an exit — a page repeated in the
 * kept list at its last rank alone —, clearing its claim bit; `dagCutKeep` makes the snapshot the
 * kept one and writes the two counts in the difference's header. Entries fill the list's `listCap`
 * words from the start, exits from the end: more of both than the words hold is said by their
 * counts, and the host reads that snapshot's list whole instead. All three run only in a dispatch
 * that copies a snapshot (`../encode.ts`), so the kept one is always the last snapshot COPIED, and
 * each difference is taken against the readback before it. A buffer just made keeps empty lists.
 *
 * GPU cost per copied snapshot, for lists of `C` and kept lists of `K` ranks, `L` the list cap: the
 * difference `C` threads and the keep `C`, as before; the exit `L` threads, of which `K` read two
 * words; `Δ` atomic appends; the claim bits `L / 32` words. The readback holds four words more than
 * the ranks it carried: the counts.
 */
/** The kernels of each kept list, the camera's requests then the drawn pages. */
export const DIFFERENCE_STAGES = ['dagCutDifference0', 'dagCutDifference1'] as const,
  EXIT_STAGES = ['dagCutExit0', 'dagCutExit1'] as const,
  KEEP_STAGES = ['dagCutKeep0', 'dagCutKeep1'] as const

export const DAG_DIFFERENCE_WGSL = `const RANK_NONE:u32=${SELECTION_NONE}u;
/** Admission bucket \`b\`'s count of the camera's requests in \`out.pages\`, behind the eviction
 *  burst (\`levelCountsWord\`). */
fn levelCountAt(b:u32)->u32{return 2u*views[0u].listCap+2u*HEAD+${EVICTION_BURST}u+b;}
/** Word \`k\` of the difference in \`out.pages\`, behind the level counts (\`differenceWord\`). */
fn differenceAt(k:u32)->u32{return levelCountAt(${ADMISSION_BUCKETS}u+k);}
/** Word \`s\` of list \`l\`'s difference (0 the camera's requests, 1 the drawn pages), behind the
 *  counts: entries from the start, exits from the end. */
fn deltaAt(l:u32,s:u32)->u32{return differenceAt(${DIFFERENCE_HEADER_WORDS}u+l*views[0u].listCap+s);}
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
/** The list's counters and claim bits, behind its page words in its own buffer (\`work\`). */
fn enteredCounter()->u32{return views[0u].clusterCount;}
fn exitedCounter()->u32{return views[0u].clusterCount+1u;}
fn claimedWord(r:u32)->u32{return views[0u].clusterCount+2u+(r>>5u);}
/** The rank page \`i\` holds in kept list \`l\`, or none: the rank last written for it — in the
 *  list's own words, bound as \`work\` —, when the kept list holds the page there. A page repeated
 *  in the list is found at one of its ranks. */
fn keptRankOf(l:u32,i:u32)->u32{
 let r=atomicLoad(&work[i]);
 if(r<out.pages[keptAt(l)]&&out.pages[keptPage(l,r)]==i){return r;}
 return RANK_NONE;
}
${[0, 1].map(listKernels).join('')}`

/** List \`l\`'s three kernels, its ranks bound as \`work\`. */
function listKernels(l: number) {
  return `/** List ${l}: a page with no kept rank entered; any other claims its kept rank. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${DIFFERENCE_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 if(s>=listCount(${l}u)){return;}
 let page=listPage(${l}u,s);let r=keptRankOf(${l}u,page);
 if(r!=RANK_NONE){atomicOr(&work[claimedWord(r)],1u<<(r&31u));return;}
 let e=atomicAdd(&work[enteredCounter()],1u);
 if(e<views[0u].listCap){out.pages[deltaAt(${l}u,e)]=page;}
}
/** List ${l}: a kept rank no page claimed left — at its page's last rank —, its claim cleared. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${EXIT_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let r=flatIndex(id.x,id.y,n.x);
 if(r>=out.pages[keptAt(${l}u)]||r>=views[0u].listCap){return;}
 let bit=1u<<(r&31u);
 let claimed=(atomicAnd(&work[claimedWord(r)],~bit)&bit)!=0u;
 let page=out.pages[keptPage(${l}u,r)];
 if(claimed||atomicLoad(&work[page])!=r){return;}
 let x=atomicAdd(&work[exitedCounter()],1u);
 if(x<views[0u].listCap){out.pages[deltaAt(${l}u,views[0u].listCap-1u-x)]=page;}
}
/** List ${l} of this snapshot becomes the kept one: its pages, the rank of each, its length; its
 *  difference's counts written, its counters cleared. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn ${KEEP_STAGES[l]}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 if(s<listCount(${l}u)){let page=listPage(${l}u,s);out.pages[keptPage(${l}u,s)]=page;atomicStore(&work[page],s);}
 if(s==0u){
  out.pages[keptAt(${l}u)]=listCount(${l}u);
  out.pages[differenceAt(${2 * l}u)]=atomicExchange(&work[enteredCounter()],0u);
  out.pages[differenceAt(${2 * l + 1}u)]=atomicExchange(&work[exitedCounter()],0u);
 }
}
`
}
