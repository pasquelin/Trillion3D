import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { BLOCK_MASK_WORDS_WGSL } from './floorWgsl.ts'
import { PEAK_CANDIDATES, PEAK_NODES, PEAK_VISIBLE } from '../readoutWords.ts'

export const DAG_COMMIT_WGSL = wgslBlock(
  'DAG_COMMIT_WGSL',
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, BLOCK_MASK_WORDS_WGSL],
  `/**
 * The cut's mask and drawn log made the frame's: what fits its lists when one was full — what passed
 * a cap was dropped as it was asked (\`../lists/listsWgsl.ts\`), never drawn —, the whole cut
 * otherwise. Run after the main pass of a cut in two passes — what the first raster pass draws — and
 * once the cut is finished. One thread a word of the masks; the log — the live list's pages, every
 * one drawn (\`dagMask\`) — copied in strides by the same threads, its count and groups set by the
 * first (\`setDrawn\`), which also writes each list's peak into the drawn list's header
 * (\`PEAK_NODES\`, \`../readoutWords.ts\`): the most a pass asked of it — the main pass's alone until
 * the post pass opens (\`dagPostPrepare\`) —, what the readback's warning reads
 * (\`../lists/listFeedback.ts\`). Every peak is counted past its cap, as asked: the candidate
 * clusters the main pass listed against those the post pass's list holds — what the main pass held
 * for it and what it listed itself (\`mainClusterWord\`, \`clusterTotalWord\`).
 */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagCommitMask(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(id,n,WORKGROUP_THREADS);let threads=n.x*n.y*WORKGROUP_THREADS;let words=BLOCK_MASK_WORDS*blockCount();
 if(t<words){atomicStore(&work[liveMaskBase()+t],atomicLoad(&work[drawMaskBase()+t]));}
 let count=liveCount();
 for(var e=t;e<count;e+=threads){setFlag(journalBase()+e,liveAt(e));}
 if(t!=0u){return;}
 setDrawn(count);
 let peaks=views[0u].listCap;let post=cutPass()==CUT_POST;
 out.pages[peaks+${PEAK_NODES}u]=max(atomicLoad(&work[nodeTotalWord(CUT_MAIN)]),atomicLoad(&work[nodeTotalWord(CUT_POST)]));
 let asked=atomicLoad(&work[clusterTotalWord()]);let mainAsked=atomicLoad(&work[mainClusterWord()]);
 out.pages[peaks+${PEAK_CANDIDATES}u]=max(mainAsked,asked-mainAsked);
 let live=atomicLoad(&work[liveCounter()]);let mainLive=select(live,liveFirst(),post);
 out.pages[peaks+${PEAK_VISIBLE}u]=max(mainLive,live-mainLive);
}
`,
)
