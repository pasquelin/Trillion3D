import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { DRAW_UNPAGED } from './plan.ts'
import { PLAN_PIPELINE_MASK, PLAN_SHIFT, PLAN_VERTEX_CULL_BIT } from './planEntry.ts'
import { INSTANCE_CULL_SHIFT } from './runs.ts'
import { EXPAND_GROUP, RUN_WORDS } from './planLayout.ts'
import { expandUniformWgsl } from './expandUniform.ts'
import { EXPAND_BINDING as B } from './expandBindings.ts'
import { LANE_SCAN_WGSL } from '../../gpu/core/laneScanWgsl.ts'

/**
 * The kernel's four dispatches: one thread group per entry packet, ONE for the running sum over
 * packets, one thread per entry, one thread per run. Written once for production encoding and for
 * the “GPU = model” proof that replays the kernel.
 */
/** The kernel's four entry points, in the order they chain. */
export const BLEND_EXPAND_ENTRIES = [
  'countBlendGroups',
  'scanBlendGroups',
  'placeBlendEntries',
  'writeBlendRuns',
]

export function blendExpandDispatch(out: number[], entries: number, runs: number) {
  const groups = workgroupCount(entries, EXPAND_GROUP)
  out[0] = groups
  out[1] = 1
  out[2] = groups
  out[3] = workgroupCount(runs, EXPAND_GROUP)
  return out
}

/**
 * EXPANSION OF THE SORTED PLAN, ON THE GPU.
 *
 * The paint order and the runs of its slots are the order kernel's (`orderWgsl.ts`), the frustum
 * verdict, one bit per item, the CPU's. The rest — how many instances each entry carries, where
 * each goes in the list, and each run's indirect argument — is computed here, from the counts
 * transparent compaction has just written in the same submission.
 *
 * Four dispatches: one thread group per entry packet, which counts and scans the packet locally;
 * the running sum over packets, at two levels; each entry's absolute place followed by writing
 * its instances; then each run's argument. No thread recounts what another has just computed.
 * The reference semantics is that of `expandCpu.fixture.ts`, the oracle its proofs compare it
 * with word for word.
 *
 * `scratch` holds each entry's place then each packet's, in that order. The two passes — blend
 * then transmission — chain in the same compute pass and hand it back to each other, since their
 * dispatches are ordered; their instances and arguments live in two disjoint regions the uniform
 * names.
 */
export const BLEND_EXPAND_SHADER = `${expandUniformWgsl()}
@group(0) @binding(${B.uni}) var<uniform> uni:Uni;
@group(0) @binding(${B.plan}) var<storage,read> plan:array<u32>;
@group(0) @binding(${B.keep}) var<storage,read> keep:array<u32>;
@group(0) @binding(${B.draws}) var<storage,read> draws:array<vec4u>;
@group(0) @binding(${B.counts}) var<storage,read> counts:array<u32>;
@group(0) @binding(${B.clusters}) var<storage,read> clusters:array<u32>;
@group(0) @binding(${B.scratch}) var<storage,read_write> scratch:array<u32>;
@group(0) @binding(${B.expanded}) var<storage,read_write> expanded:array<vec2u>;
@group(0) @binding(${B.args}) var<storage,read_write> args:array<u32>;
const GROUP=${EXPAND_GROUP}u;
fn itemOf(i:u32)->u32{return plan[uni.orderBase+i]>>${PLAN_SHIFT}u;}
fn kept(item:u32)->bool{return (keep[item>>5u]&(1u<<(item&31u)))!=0u;}
/** What a plan entry expands: the clusters compaction kept for it, the chunks an unpaged
 *  primitive carries, nothing at all if the frustum rejected its item. */
fn instancesOf(i:u32)->u32{
 let item=itemOf(i);
 if(!kept(item)){return 0u;}
 let d=draws[item];
 if(d.x==${DRAW_UNPAGED}u){return d.y;}
 return counts[d.x*4u+1u];
}
${LANE_SCAN_WGSL}/** One thread group per entry packet: each counts ITS entry once, and the packet takes from that
 *  in one go each local place and its total (the shared lane scan: EXPAND_GROUP is 64). */
@compute @workgroup_size(${EXPAND_GROUP})
fn countBlendGroups(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
 let i=id.x;
 let k=lid.x;
 var mien=0u;
 if(i<uni.entryCount){mien=instancesOf(i);}
 let inclusive=laneScan(k,mien);
 if(i<uni.entryCount){scratch[i]=inclusive-mien;}
 if(k==GROUP-1u){scratch[uni.entryCount+wid.x]=inclusive;}
}
/** Running sum over packets, at two levels: each thread takes a slice, the packet scans the
 *  sixty-four subtotals, then each thread puts its own back. */
@compute @workgroup_size(${EXPAND_GROUP})
fn scanBlendGroups(@builtin(local_invocation_id) lid:vec3u){
 let k=lid.x;
 let span=laneRun(k,uni.groupCount);
 var somme=0u;
 for(var g=span.x;g<span.y;g++){somme=somme+scratch[uni.entryCount+g];}
 var curseur=uni.instanceBase+laneScan(k,somme)-somme;
 for(var g=span.x;g<span.y;g++){
  let tenu=scratch[uni.entryCount+g];
  scratch[uni.entryCount+g]=curseur;
  curseur=curseur+tenu;
 }
}
/** Absolute place of each entry, then its instances: the local place is already counted. */
@compute @workgroup_size(${EXPAND_GROUP})
fn placeBlendEntries(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.entryCount){return;}
 let at=scratch[uni.entryCount+i/GROUP]+scratch[i];
 scratch[i]=at;
 let held=instancesOf(i);
 if(held==0u){return;}
 let entry=plan[uni.orderBase+i];
 let item=entry>>${PLAN_SHIFT}u;
 // The cull mode the vertex stage applies, above the item rank, as instanceWord packs it: the
 // pipeline's rank among the three of its blend mode (planCull).
 let word=item|select(0u,((entry&${PLAN_PIPELINE_MASK}u)%3u)<<${INSTANCE_CULL_SHIFT}u,(entry&${PLAN_VERTEX_CULL_BIT}u)!=0u);
 let d=draws[item];
 if(d.x==${DRAW_UNPAGED}u){
  for(var j=0u;j<held;j++){expanded[at+j]=vec2u(word,j*d.w);}
  return;
 }
 for(var j=0u;j<held;j++){expanded[at+j]=vec2u(word,clusters[d.z+j]);}
}
@compute @workgroup_size(${EXPAND_GROUP})
fn writeBlendRuns(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;
 if(r>=uni.runCount){return;}
 let at=uni.runsBase+r*${RUN_WORDS}u;
 let first=plan[at];
 let entries=plan[at+1u];
 let o=uni.argsBase+r*4u;
 // An empty slot (\`runs.ts\`): a draw of no instance.
 if(entries==0u){
  args[o]=uni.maxVertexWords;
  args[o+1u]=0u;
  args[o+2u]=0u;
  args[o+3u]=0u;
  return;
 }
 let last=first+entries-1u;
 let base=scratch[first];
 // A run of several entries draws shared clusters, at the table stride; a run of one unpaged item
 // draws what ITS item carries — one read of its sixteen-byte draw description.
 let described=draws[plan[uni.orderBase+first]>>${PLAN_SHIFT}u];
 var vertexCount=uni.maxVertexWords;
 if(entries==1u&&described.x==${DRAW_UNPAGED}u){vertexCount=described.w;}
 args[o]=vertexCount;
 args[o+1u]=scratch[last]+instancesOf(last)-base;
 args[o+2u]=base<<uni.vertexShift;
 args[o+3u]=0u;
}
`
