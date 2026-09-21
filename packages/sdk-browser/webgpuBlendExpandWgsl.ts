import { DRAW_UNPAGED, PLAN_SHARED_BIT, PLAN_SHIFT } from './webgpuBlendPlan.ts';
import { EXPAND_GROUP, expandUniformWgsl, RUN_WORDS } from './webgpuBlendRuns.ts';

/** The kernel's eight storage buffers, in the rank order the shader declares. */
export const STORAGE_TYPES: GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'storage',
];

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
];

export function blendExpandDispatch(out: number[], entries: number, runs: number) {
  const groups = Math.ceil(Math.max(1, entries) / EXPAND_GROUP);
  out[0] = groups;
  out[1] = 1;
  out[2] = groups;
  out[3] = Math.ceil(Math.max(1, runs) / EXPAND_GROUP);
  return out;
}

/**
 * EXPANSION OF THE SORTED PLAN, ON THE GPU.
 *
 * The CPU now gives only one thing per frame: the paint order, its runs and the frustum verdict,
 * one bit per item. The rest — how many instances each entry carries, where each goes in the
 * list, and each run's indirect argument — is computed here, from the counts transparent
 * compaction has just written in the same submission.
 *
 * Four dispatches: one thread group per entry packet, which counts and scans the packet locally;
 * the running sum over packets, at two levels; each entry's absolute place followed by writing
 * its instances; then each run's argument. No thread recounts what another has just computed.
 * The reference semantics is that of `webgpuBlendExpandCpu.ts`, which the CPU fallback follows,
 * and the `transparents-ordres.bench.ts` bench compares both outputs word for word.
 *
 * `scratch` holds each entry's place then each packet's, in that order. The two passes — blend
 * then transmission — chain in the same compute pass and hand it back to each other, since their
 * dispatches are ordered; their instances and arguments live in two disjoint regions the uniform
 * names.
 */
export const BLEND_EXPAND_SHADER = `${expandUniformWgsl()}
@group(0) @binding(0) var<uniform> uni:Uni;
@group(0) @binding(1) var<storage,read> plan:array<u32>;
@group(0) @binding(2) var<storage,read> keep:array<u32>;
@group(0) @binding(3) var<storage,read> draws:array<vec4u>;
@group(0) @binding(4) var<storage,read> counts:array<u32>;
@group(0) @binding(5) var<storage,read> clusters:array<u32>;
@group(0) @binding(6) var<storage,read_write> scratch:array<u32>;
@group(0) @binding(7) var<storage,read_write> expanded:array<vec2u>;
@group(0) @binding(8) var<storage,read_write> args:array<u32>;
const GROUP=${EXPAND_GROUP}u;
var<workgroup> tuile:array<u32,${EXPAND_GROUP}>;
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
/** Inclusive prefix sum of the packet's sixty-four values, in six doubling steps. */
fn scanTuile(k:u32){
 for(var pas=1u;pas<GROUP;pas=pas<<1u){
  var pris=0u;
  if(k>=pas){pris=tuile[k-pas];}
  workgroupBarrier();
  tuile[k]=tuile[k]+pris;
  workgroupBarrier();
 }
}
/** One thread group per entry packet: each counts ITS entry once, and the packet takes from that
 *  in one go each local place and its total. */
@compute @workgroup_size(${EXPAND_GROUP})
fn countBlendGroups(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
 let i=id.x;
 let k=lid.x;
 var mien=0u;
 if(i<uni.entryCount){mien=instancesOf(i);}
 tuile[k]=mien;
 workgroupBarrier();
 scanTuile(k);
 if(i<uni.entryCount){scratch[i]=tuile[k]-mien;}
 if(k==GROUP-1u){scratch[uni.entryCount+wid.x]=tuile[k];}
}
/** Running sum over packets, at two levels: each thread takes a slice, the packet scans the
 *  sixty-four subtotals, then each thread puts its own back. */
@compute @workgroup_size(${EXPAND_GROUP})
fn scanBlendGroups(@builtin(local_invocation_id) lid:vec3u){
 let k=lid.x;
 let par=(uni.groupCount+GROUP-1u)/GROUP;
 let debut=min(k*par,uni.groupCount);
 let fin=min(debut+par,uni.groupCount);
 var somme=0u;
 for(var g=debut;g<fin;g++){somme=somme+scratch[uni.entryCount+g];}
 tuile[k]=somme;
 workgroupBarrier();
 scanTuile(k);
 var curseur=uni.instanceBase+tuile[k]-somme;
 for(var g=debut;g<fin;g++){
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
 let item=itemOf(i);
 let d=draws[item];
 if(d.x==${DRAW_UNPAGED}u){
  for(var j=0u;j<held;j++){expanded[at+j]=vec2u(item,j*d.w);}
  return;
 }
 for(var j=0u;j<held;j++){expanded[at+j]=vec2u(item,clusters[d.z+j]);}
}
@compute @workgroup_size(${EXPAND_GROUP})
fn writeBlendRuns(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;
 if(r>=uni.runCount){return;}
 let at=uni.runsBase+r*${RUN_WORDS}u;
 let first=plan[at];
 let entries=plan[at+1u];
 let last=first+entries-1u;
 let base=scratch[first];
 // The merging run draws clusters, at the table stride; the one that kept a single entry draws
 // what ITS item carries. The owner is read on the entry, as on the CPU.
 let entry=plan[uni.orderBase+first];
 let fusionne=entries>1u&&(entry&${PLAN_SHARED_BIT}u)!=0u;
 var vertexCount=uni.maxVertexWords;
 // One read of the draw description: it is sixteen bytes, and the two fields read come out of it
 // together.
 let dessin=draws[entry>>${PLAN_SHIFT}u];
 if(!fusionne&&dessin.x==${DRAW_UNPAGED}u){vertexCount=dessin.w;}
 let o=uni.argsBase+r*4u;
 args[o]=vertexCount;
 args[o+1u]=scratch[last]+instancesOf(last)-base;
 args[o+2u]=base<<uni.vertexShift;
 args[o+3u]=0u;
}
`;
