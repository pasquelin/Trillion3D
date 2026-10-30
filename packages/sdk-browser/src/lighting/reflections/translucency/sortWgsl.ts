import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'

/** The threads of a workgroup of the sort, its bins (one for each two threads), and the traces a thread takes. */
export const SORT_THREADS = 256
export const SORT_BINS = SORT_THREADS / 2
export const SORT_ELEMENTS_PER_THREAD = 16
/** The traces one workgroup sorts. */
export const SORT_TRACES = SORT_THREADS * SORT_ELEMENTS_PER_THREAD

/** The bindings of the sort, in group 0. */
export const SORT_BINDINGS = { traces: 0, sorted: 1, materials: 2, args: 3 } as const

/**
 * THE TRACES SORTED BY THE MATERIAL OF THEIR HIT (`sortTracesByMaterial`), so that the threads of the second, hit-lit trace that follow one another
 * shade the same material: a workgroup takes `SORT_TRACES` consecutive entries of the compacted list `traces` (a count first, then the entries, a texel's
 * place and its hit distance as the reflections' lists hold them), counts them in `SORT_BINS` bins by the material id of the texel they stand for
 * (`materials`, the low fifteen bits of the word the first trace wrote, the sixteenth saying the hit needs the hit lighting) modulo the bins, takes each bin's
 * offset as the sum of the bins before it and writes the entries to `sorted`, bin by bin, in the order the counts gave them. The entries of a group stay in its
 * range. `sortTracesArgs` makes the indirect dispatch of the sort from the count: one workgroup for each `SORT_TRACES` entries.
 */
export const SORT_TRACES_WGSL = wgslProgram(
  `struct SortList{count:u32,entries:array<vec2u>,}
@group(0) @binding(${SORT_BINDINGS.traces}) var<storage,read> sortTraces:SortList;
@group(0) @binding(${SORT_BINDINGS.sorted}) var<storage,read_write> sortedTraces:array<vec2u>;
@group(0) @binding(${SORT_BINDINGS.materials}) var sortMaterials:texture_2d<u32>;
@group(0) @binding(${SORT_BINDINGS.args}) var<storage,read_write> sortArgs:array<u32,3>;
var<workgroup> bins:array<atomic<u32>,${SORT_BINS}>;
var<workgroup> offsets:array<u32,${SORT_BINS}>;
fn sortMaterialOf(entry:vec2u)->u32{
 let texel=vec2i(vec2u(entry.x&0xffffu,entry.x>>16u));
 return textureLoad(sortMaterials,texel,0).r&0x7fffu;
}
@compute @workgroup_size(1)
fn sortTracesArgs(){
 sortArgs[0]=(sortTraces.count+${SORT_TRACES - 1}u)/${SORT_TRACES}u;
 sortArgs[1]=1u;
 sortArgs[2]=1u;
}
@compute @workgroup_size(${SORT_THREADS})
fn sortTracesByMaterial(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let base=group.x*${SORT_TRACES}u;
 if(lane<${SORT_BINS}u){atomicStore(&bins[lane],0u);offsets[lane]=0u;}
 workgroupBarrier();
 var held:array<vec2u,${SORT_ELEMENTS_PER_THREAD}>;
 var bin:array<u32,${SORT_ELEMENTS_PER_THREAD}>;
 var rank:array<u32,${SORT_ELEMENTS_PER_THREAD}>;
 for(var k=0u;k<${SORT_ELEMENTS_PER_THREAD}u;k++){
  let i=lane+k*${SORT_THREADS}u;
  if(base+i<sortTraces.count){
   let entry=sortTraces.entries[base+i];
   held[k]=entry;
   bin[k]=sortMaterialOf(entry)%${SORT_BINS}u;
   rank[k]=atomicAdd(&bins[bin[k]],1u);
  }
 }
 workgroupBarrier();
 if(lane<${SORT_BINS}u){
  var sum=0u;
  for(var b=0u;b<lane;b++){sum+=atomicLoad(&bins[b]);}
  offsets[lane]=sum;
 }
 workgroupBarrier();
 for(var k=0u;k<${SORT_ELEMENTS_PER_THREAD}u;k++){
  let i=lane+k*${SORT_THREADS}u;
  if(base+i<sortTraces.count){sortedTraces[base+offsets[bin[k]]+rank[k]]=held[k];}
 }
}`,
  [],
)
