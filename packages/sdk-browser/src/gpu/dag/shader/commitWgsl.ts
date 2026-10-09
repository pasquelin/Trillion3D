import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../../dispatch/grid.ts'
import { ceilDiv } from '../../../../../math/src/wgsl/integer.ts'
import { WORK_DROPPED } from './viewsWgsl.ts'

export const DAG_COMMIT_WGSL = wgslBlock(
  'DAG_COMMIT_WGSL',
  [ceilDiv, FLAT_INDEX_WGSL, GROUP_GRID_WGSL],
  `/**
 * The cut's mask and drawn log made the frame's, unless work was dropped (\`dropWork\`): a cut whose
 * queue or list was full is not drawn, the frame keeps the last whole cut's mask and log, and the
 * host grows the lists before it cuts again (\`../queueGrowth.ts\`). One thread a word of the masks;
 * the log copied in strides by the same threads, its count and groups armed by the first.
 */
@compute @workgroup_size(64)
fn dagCommitMask(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 if((atomicLoad(&out.overflow)&${WORK_DROPPED}u)!=0u){return;}
 let t=flatIndex(id,n,64u);let threads=n.x*n.y*64u;let words=2u*blockCount();
 if(t<words){atomicStore(&work[liveMaskBase()+t],atomicLoad(&work[drawMaskBase()+t]));}
 let count=min(atomicLoad(&work[writtenCounter()]),views[0u].candCap);
 for(var e=t;e<count;e+=threads){setFlag(journalBase()+e,flagAt(writtenBase()+e));}
 if(t==0u){
  let grid=select(vec2u(0u),groupGrid(ceilDiv(count,64u)),count>0u);
  atomicStore(&work[drawnCounter()],count);
  atomicStore(&work[drawnGroups()],grid.x);atomicStore(&work[drawnGroups()+1u],grid.y);
 }
}
`,
)
