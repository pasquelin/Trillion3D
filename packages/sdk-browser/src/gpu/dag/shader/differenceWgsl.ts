import { EVICTION_BURST } from '../readoutWords.ts'
import { KEPT_HEADER_WORDS } from '../layout.ts'
import { SELECTION_NONE, SELECTION_WORKGROUP } from '../../core/selection.ts'
import { rankBlockWord } from './floorWgsl.ts'

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
 * then the requests' pages and the drawn pages, a list each. Beside it in `work`, for each list, a
 * word a page: the rank `dagCutKeep` last wrote for it. That word is believed only where the kept
 * list still holds the page at that rank, so no mask of the kept pages is kept nor cleared, and a
 * kept list cut short by the cap names exactly what it holds.
 *
 * `dagCutDifference` and `dagCutKeep` run only in a dispatch that copies a snapshot, so the kept one
 * is always the last snapshot COPIED, and the readbacks land in the order they were copied: each
 * difference is taken against the readback before it. A buffer just made keeps empty lists.
 */
export const DAG_DIFFERENCE_WGSL = `const RANK_NONE:u32=${SELECTION_NONE}u;
/** Word \`k\` of the difference in \`out.pages\`, behind the eviction burst (\`differenceWord\`). */
fn differenceAt(k:u32)->u32{return 2u*views[0u].listCap+2u*HEAD+${EVICTION_BURST}u+k;}
/** List \`l\`'s difference (0 the camera's requests, 1 the drawn pages): the rank each of its pages
 *  held in the kept list. */
fn fromAt(l:u32,s:u32)->u32{return differenceAt(l*views[0u].listCap+s);}
/** Word \`k\` of the kept snapshot in \`out.pages\`, behind the staged requests ahead
 *  (\`keptSnapshotWord\`): the two lengths, then the requests' pages, then the drawn pages. */
fn keptAt(k:u32)->u32{return aheadStagedAt(aheadCap()+k);}
fn keptPage(l:u32,s:u32)->u32{return keptAt(${KEPT_HEADER_WORDS}u+l*views[0u].listCap+s);}
/** The word of page \`i\` behind the draw mask that holds its rank in kept list \`l\`
 *  (\`dagWorkLayout\`). */
fn keptRankAt(l:u32,i:u32)->u32{return blockCount()*(${rankBlockWord(0)}u+BLOCK*l)+i;}
/** List \`l\` as long as the host reads it, and its page at rank \`s\`: the camera's requests, the
 *  drawn pages. */
fn listCount(l:u32)->u32{
 if(l==0u){return min(atomicLoad(&out.count),views[0u].listCap);}
 return min(out.pages[views[0u].listCap],views[0u].listCap);
}
fn listPage(l:u32,s:u32)->u32{
 if(l==0u){return requestPage(out.pages[s]);}
 return out.pages[views[0u].listCap+HEAD+s];
}
/** The rank page \`i\` holds in kept list \`l\`, or none: the rank last written for it, when the
 *  kept list holds the page there. A page repeated in the list is found at one of its ranks. */
fn keptRankOf(l:u32,i:u32)->u32{
 let r=atomicLoad(&work[keptRankAt(l,i)]);
 if(r<out.pages[keptAt(l)]&&out.pages[keptPage(l,r)]==i){return r;}
 return RANK_NONE;
}
/** One thread per rank, for both lists: its page's rank in the kept list. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn dagCutDifference(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 for(var l=0u;l<2u;l++){if(s<listCount(l)){out.pages[fromAt(l,s)]=keptRankOf(l,listPage(l,s));}}
}
/** This snapshot becomes the kept one: its two lists, the rank of each of their pages, and their
 *  lengths. One thread per rank. */
@compute @workgroup_size(${SELECTION_WORKGROUP})
fn dagCutKeep(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id.x,id.y,n.x);
 for(var l=0u;l<2u;l++){
  if(s<listCount(l)){let page=listPage(l,s);out.pages[keptPage(l,s)]=page;atomicStore(&work[keptRankAt(l,page)],s);}
  if(s==0u){out.pages[keptAt(l)]=listCount(l);}
 }
}
`

/** Workgroups of each kernel above, for a list of `listCap` ranks: a thread a rank. */
export const differenceGroups = (listCap: number) =>
  Math.max(1, Math.ceil(listCap / SELECTION_WORKGROUP))
