import { COMPUTE } from '../../gpu/core/computeBindings.ts'
import { PLAN_SHIFT } from './planEntry.ts'
import { EXPAND_PASSES, RUN_WORDS } from './planLayout.ts'
import { dAdd, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

/**
 * THE PAINT ORDER OF A TRANSPARENT PASS, SORTED ON THE GPU.
 *
 * Each frame the CPU sends the eye, and the keys and order of the few own entries it orders itself
 * (`order.ts`); everything else is here. A workgroup loads a block of the pass's seeded entries with
 * their keys — computed in emulated doubles (`math/src/wgsl/double.ts`), so they are the CPU's to the bit —
 * and sorts it in its memory; blocks are then merged by a bitonic network, one dispatch per step too
 * wide for a workgroup, the steps that fit finished in the workgroup again. The last dispatch writes
 * the sorted entries where the expansion kernel reads them and where each seed landed;
 * `placeBlendSlots` then gives each draw slot its run (`runs.ts`).
 *
 * The order is the one `precedes` defines (`paintOrder.ts`): decreasing key, then increasing seed —
 * the seeds are in source order, back before face, so that is the CPU's rank rule. A key is
 * compared as its unsigned 64-bit pattern: keys are never negative, and a NaN, all ones, lies above
 * +∞. The padding past the pass's entries sorts after every entry: key zero, the largest seed.
 *
 * Why a bitonic network: its steps are fixed by the padded size alone, which the CPU knows from the
 * plan, so it encodes them without asking the GPU anything; it sorts in place, with no atomic and no
 * extra memory; and the counts are those of transparent entries, a few thousand at most, where its
 * `n·log²n/4` compare-exchanges cost microseconds. A radix sort would need eight passes of three
 * dispatches over the 64-bit keys.
 */

/** Entries a workgroup sorts in its memory, and its threads, one per compare-exchange: 256 is
 *  WebGPU's default maximum of invocations per workgroup, and 512 entries of 16 bytes take 8 KiB of
 *  workgroup memory, half the default limit. */
export const SORT_BLOCK = 512
const SORT_THREADS = SORT_BLOCK / 2
/** Threads of the slot kernel's groups. */
export const SLOT_GROUP = 64
/** Words of an item's key record (`keyRecords.ts`): six doubles, then its flags and its own rank. */
export const KEY_RECORD_WORDS = 16
export const KEY_HAS_BOX = 1
/** Own rank of an item the GPU keys itself. */
export const NOT_OWN = 0xffffffff
/** Words of the frame data before the own keys: the eye, four doubles. */
export const FRAME_EYE_WORDS = 8
/** Words of the frame data a scene of `items` items, `entries` entries a pass, can send at most:
 *  the eye, a key per item, a seed and a slot per entry of each pass (`order.ts`). */
export const orderFrameWords = (items: number, entries: number) =>
  FRAME_EYE_WORDS + 2 * items + 2 * EXPAND_PASSES * entries

/** The kernel's three entry points: a block sort or merge, a step across blocks, the slots. */
export const BLEND_ORDER_ENTRIES = ['sortBlendBlocks', 'sortBlendStep', 'placeBlendSlots'] as const

/** The uniform words of one dispatch, at its dynamic offset: written once per plan (`orderSteps.ts`). */
const ORDER_UNI_FIELDS = [
  'entryCount',
  'size',
  'seedBase',
  'orderBase',
  'runsBase',
  'ownSeedBase',
  'ownSlotBase',
  'ownCount',
  'gaps',
  'stageFrom',
  'stageTo',
  'step',
  'fresh',
  'last',
  'ownKeyBase',
] as const
export const ORDER_UNI_WORDS = 16
export const ORDER_UNI = Object.fromEntries(
  ORDER_UNI_FIELDS.map((name, rank) => [name, rank]),
) as Record<(typeof ORDER_UNI_FIELDS)[number], number>
const orderUniformWgsl = () =>
  wgslBlock(
    'orderUniformWgsl',
    [],
    `struct OrderUni{${ORDER_UNI_FIELDS.map((name) => `${name}:u32,`).join('')}}`,
  )

/** Group-0 binding of each buffer the order kernel reads, under its WGSL name. */
export const ORDER_BINDING = {
  uni: 0,
  plan: 1,
  keyed: 2,
  frame: 3,
  sorted: 4,
  placed: 5,
} as const
const B = ORDER_BINDING

/** Group-0 layout entries of the order kernel, read from the names above: the uniform at its
 *  dynamic offset, then its five storage buffers. */
export function blendOrderBindEntries(): GPUBindGroupLayoutEntry[] {
  const storage = (type: GPUBufferBindingType) => ({ visibility: COMPUTE, buffer: { type } })
  return [
    {
      binding: B.uni,
      visibility: COMPUTE,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: ORDER_UNI_WORDS * 4 },
    },
    { binding: B.plan, ...storage('storage') },
    { binding: B.keyed, ...storage('read-only-storage') },
    { binding: B.frame, ...storage('read-only-storage') },
    { binding: B.sorted, ...storage('storage') },
    { binding: B.placed, ...storage('storage') },
  ]
}

export const BLEND_ORDER_SHADER = wgslProgram(
  `@group(0) @binding(${B.uni}) var<uniform> uni:OrderUni;
@group(0) @binding(${B.plan}) var<storage,read_write> plan:array<u32>;
@group(0) @binding(${B.keyed}) var<storage,read> keyed:array<u32>;
@group(0) @binding(${B.frame}) var<storage,read> frame:array<u32>;
@group(0) @binding(${B.sorted}) var<storage,read_write> sorted:array<vec4u>;
@group(0) @binding(${B.placed}) var<storage,read_write> placed:array<u32>;
var<workgroup> held:array<vec4u,${SORT_BLOCK}>;
fn keyedDouble(at:u32)->vec2u{return vec2u(keyed[at+1u],keyed[at]);}
fn frameDouble(at:u32)->vec2u{return vec2u(frame[at+1u],frame[at]);}
/** One axis of the eye-to-box-centre gap: each bound brought to the eye, then the two averaged. */
fn boxAxis(low:vec2u,high:vec2u,eye:vec2u)->vec2u{return dMul(dAdd(dSub(low,eye),dSub(high,eye)),vec2u(0x3fe00000u,0u));}
/**
 * An item's key, as \`eyeKey\` computes it on the CPU (\`order.ts\`): the square of the distance from
 * the eye to its world box centre, its world origin without a box. An own item's key is the one the
 * CPU ordered it with.
 */
fn itemKey(item:u32)->vec2u{
 let at=item*${KEY_RECORD_WORDS}u;
 let own=keyed[at+13u];
 if(own!=${NOT_OWN}u){return frameDouble(uni.ownKeyBase+own*2u);}
 let ex=frameDouble(0u);
 let ey=frameDouble(2u);
 let ez=frameDouble(4u);
 var x=vec2u(0u,0u);
 var y=vec2u(0u,0u);
 var z=vec2u(0u,0u);
 if((keyed[at+12u]&${KEY_HAS_BOX}u)!=0u){
  x=boxAxis(keyedDouble(at),keyedDouble(at+6u),ex);
  y=boxAxis(keyedDouble(at+2u),keyedDouble(at+8u),ey);
  z=boxAxis(keyedDouble(at+4u),keyedDouble(at+10u),ez);
 }else{
  x=dSub(keyedDouble(at),ex);
  y=dSub(keyedDouble(at+2u),ey);
  z=dSub(keyedDouble(at+4u),ez);
 }
 return dAdd(dAdd(dMul(x,x),dMul(y,y)),dMul(z,z));
}
fn writeRun(slot:u32,first:u32,entries:u32){
 plan[uni.runsBase+slot*${RUN_WORDS}u]=first;
 plan[uni.runsBase+slot*${RUN_WORDS}u+1u]=entries;
}
/** Whether \`a\` paints before \`b\`: the farther key, then the lower seed. */
fn goesFirst(a:vec4u,b:vec4u)->bool{
 if(a.x!=b.x){return a.x>b.x;}
 if(a.y!=b.y){return a.y>b.y;}
 return a.z<b.z;
}
/** Position \`p\` of the pass — key, seed, entry — from its seed on the first dispatch, else as the
 *  last left it. */
fn sortLoad(p:u32)->vec4u{
 if(uni.fresh==0u){return sorted[p];}
 if(p>=uni.entryCount){return vec4u(0u,0u,0xffffffffu,0u);}
 let entry=plan[uni.seedBase+p];
 let key=itemKey(entry>>${PLAN_SHIFT}u);
 return vec4u(key.x,key.y,p,entry);
}
/** Position \`p\` back; on the last dispatch, its entry where the expansion reads it, and its place. */
fn sortStore(p:u32,v:vec4u){
 sorted[p]=v;
 if(uni.last==0u||p>=uni.entryCount){return;}
 plan[uni.orderBase+p]=v.w;
 placed[v.z]=p;
}
/** The first of the pair compare-exchange \`t\` handles at step \`j\`, a power of two. */
fn pairOf(t:u32,j:u32)->u32{return ((t&~(j-1u))<<1u)|(t&(j-1u));}
/** Compare-exchange \`t\` of a block at step \`j\` of stage \`k\`, in workgroup memory. */
fn blockPair(t:u32,j:u32,k:u32,base:u32){
 let i=pairOf(t,j);
 let a=held[i];
 let b=held[i+j];
 if(select(goesFirst(a,b),goesFirst(b,a),((base+i)&k)==0u)){
  held[i]=b;
  held[i+j]=a;
 }
}
/** A block's stages \`stageFrom\` to \`stageTo\`, from their first step that fits a block down. */
@compute @workgroup_size(${SORT_THREADS})
fn sortBlendBlocks(@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u){
 // A block of the last row past the size has nothing to sort.
 let base=flatIndex(wid,n,1u)*${SORT_BLOCK}u;if(base>=uni.size){return;}
 let t=lid.x;
 held[t]=sortLoad(base+t);
 held[t+${SORT_THREADS}u]=sortLoad(base+t+${SORT_THREADS}u);
 workgroupBarrier();
 for(var k=uni.stageFrom;k<=uni.stageTo;k=k<<1u){
  for(var j=min(k>>1u,${SORT_THREADS}u);j>0u;j=j>>1u){
   blockPair(t,j,k,base);
   workgroupBarrier();
  }
 }
 sortStore(base+t,held[t]);
 sortStore(base+t+${SORT_THREADS}u,held[t+${SORT_THREADS}u]);
}
/** One step of stage \`stageTo\` whose pairs straddle blocks: \`step\` is a block or wider. */
@compute @workgroup_size(${SORT_THREADS})
fn sortBlendStep(@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(wid,n,1u)*${SORT_THREADS}u+lid.x;
 if(t>=(uni.size>>1u)){return;}
 let i=pairOf(t,uni.step);
 let l=i+uni.step;
 let a=sorted[i];
 let b=sorted[l];
 if(select(goesFirst(a,b),goesFirst(b,a),(i&uni.stageTo)==0u)){
  sorted[i]=b;
  sorted[l]=a;
 }
}
/**
 * The run of each draw slot (\`runs.ts\`), one thread per own entry: its own slot, the gap before
 * it when it starts an item — the main entries painted since the previous own entry, possibly
 * none — and, for the last, the gap after it. The own entries come in the CPU's paint order with
 * their slots, which is the GPU's order: the same keys, the same rule.
 */
@compute @workgroup_size(${SLOT_GROUP})
fn placeBlendSlots(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let k=flatIndex(id,n,${SLOT_GROUP}u);
 if(uni.ownCount==0u){
  if(k==0u&&uni.gaps!=0u){writeRun(0u,0u,uni.entryCount);}
  return;
 }
 if(k>=uni.ownCount){return;}
 let slot=frame[uni.ownSlotBase+k];
 let at=placed[frame[uni.ownSeedBase+k]];
 writeRun(slot,at,1u);
 if(uni.gaps==0u){return;}
 if(k==0u||slot-frame[uni.ownSlotBase+k-1u]>1u){
  var first=0u;
  if(k>0u){first=placed[frame[uni.ownSeedBase+k-1u]]+1u;}
  writeRun(slot-1u,first,select(0u,at-first,at>first));
 }
 if(k==uni.ownCount-1u){writeRun(slot+1u,at+1u,uni.entryCount-at-1u);}
}
`,
  [orderUniformWgsl(), dAdd, dSub, dMul, FLAT_INDEX_WGSL],
)
