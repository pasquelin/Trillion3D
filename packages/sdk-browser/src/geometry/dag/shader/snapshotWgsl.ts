import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { SELECTION_HEADER_WORDS } from '../readoutWords.ts'

/**
 * SNAPSHOT write: what the GPU reports to the CPU, and the ceiling that bounds it.
 *
 * The snapshot is the only thing a frame brings back down from the GPU. The visible clusters stay
 * in place — the rasters read them where the cluster cull put them (`visibleWgsl.ts`) —, so what
 * passes here never serves to draw: it serves to BROADCAST. From it the host takes the pages it must load, pin
 * or return to the cache.
 *
 * Each rank is a REQUEST for one leaf of the cut hierarchy: the first packed page of its pages, a
 * whole word, so any packed instance is named, in the snapshot's first list; how many pages follow
 * it, at the same rank of the page counts' list; and its priority at the same rank of the priority
 * list (`../request/request.ts`, `countWord`, `priorityWord`), in the order the threads won the
 * counter: the host orders them. A leaf's pages lie in one group, consecutive, and a streaming page
 * may end between two of them: the host asks every page a request names.
 *
 * The ceiling (`listCap`, the readout's ranks, `../lists/requestSize.ts`) bounds what the frame
 * copy takes, and follows what the cut asks of it between two frames. A refused rank sets bit 0:
 * the snapshot is then TRUNCATED, and adopted by its head (`../../cut/adoption/adoption.ts`).
 * Frame totals lose nothing — they describe the cut, not the list that reports it
 * (`totalsWgsl.ts`).
 */
export const DAG_READING_WGSL = wgslBlock(
  'DAG_READING_WGSL',
  [],
  `/** A request: the \`count\` pages from \`first\` asked for at priority word \`priority\`, at the
 *  rank its thread wins in the sample's first list, its page count and its priority at the same
 *  rank of their lists; none for a leaf without a page; past the cap it is dropped, and the sample
 *  says it is truncated. */
fn requestPage(first:u32,count:u32,priority:u32){
 if(count==0u){return;}
 let slot=atomicAdd(&out.count,1u);
 if(slot>=cutView.listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[slot]=first;
 out.pages[countAt(slot)]=count;
 out.pages[priorityAt(slot)]=priority;
}
/** Rank \`s\` of the priority list, behind the requests' and the drawn list (\`priorityWord\`,
 *  \`../readoutWords.ts\`, less \`out\`'s header: an index of \`out.pages\`). */
fn priorityAt(s:u32)->u32{return 2u*cutView.listCap+${SELECTION_HEADER_WORDS}u+s;}
/** Rank \`s\` of the page counts' list, behind the priorities (\`countWord\`). */
fn countAt(s:u32)->u32{return priorityAt(cutView.listCap+s);}
`,
)
