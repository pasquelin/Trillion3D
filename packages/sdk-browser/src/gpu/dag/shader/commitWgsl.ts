import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../dispatch/grid.ts'
import { WORK_DROPPED } from './viewsWgsl.ts'
import { BLOCK_MASK_WORDS_WGSL } from './floorWgsl.ts'

export const DAG_COMMIT_WGSL = wgslBlock(
  'DAG_COMMIT_WGSL',
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, BLOCK_MASK_WORDS_WGSL],
  `/**
 * The cut's mask and drawn log made the frame's, unless work was dropped (\`dropWork\`): a cut whose
 * queue or list was full is not drawn, the frame keeps the last whole cut's mask and log, and the
 * host grows the lists before it cuts again (\`../queueGrowth.ts\`). One thread a word of the masks;
 * the log copied in strides by the same threads, its count and groups set by the first (\`setDrawn\`).
 */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagCommitMask(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 if((atomicLoad(&out.overflow)&${WORK_DROPPED}u)!=0u){return;}
 let t=flatIndex(id,n,WORKGROUP_THREADS);let threads=n.x*n.y*WORKGROUP_THREADS;let words=BLOCK_MASK_WORDS*blockCount();
 if(t<words){atomicStore(&work[liveMaskBase()+t],atomicLoad(&work[drawMaskBase()+t]));}
 let count=min(atomicLoad(&work[writtenCounter()]),views[0u].candCap);
 for(var e=t;e<count;e+=threads){setFlag(journalBase()+e,flagAt(writtenBase()+e));}
 if(t==0u){setDrawn(count);}
}
`,
)
