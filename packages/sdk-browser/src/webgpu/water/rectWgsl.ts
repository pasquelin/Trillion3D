import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { dDiv, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { dIsNan, dIsZero, dNan } from '../../../../math/src/wgsl/doubleWords.ts'
import { dMathMax, dMathMin } from '../../../../math/src/wgsl/doubleOrder.ts'
import { dFromU32, dIsFinite, dToU32 } from '../../../../math/src/wgsl/doubleRound.ts'
import { fromF32 } from '../../../../math/src/wgsl/f32.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { KEYED_WGSL } from '../blend/keyLayout.ts'
import { FRAME_HEAD_WGSL } from '../blend/frameHead.ts'
import { VERDICT_WGSL } from '../blend/verdictLayout.ts'
import { BLEND_ITEM_WORDS, BLEND_ITEM_WORLD } from '../blend/items.ts'
import { VOLUME_ITEM, VOLUME_WORDS } from '../transparent/transmission.ts'
import { WATER_DOUBLES_WGSL, WATER_ENCLOSE_WGSL } from './encloseWgsl.ts'
import { WATER_PROJECT_WGSL } from './projectWgsl.ts'
import { WATER_ITEM_WGSL } from './waterItems.ts'
import { WATER_ARGS_WGSL } from './argsWgsl.ts'

/** Group-0 binding of each buffer the rectangle reads or writes, under its WGSL name. */
export const WATER_RECT_BINDING = {
  frame: 0,
  keyed: 1,
  waterItems: 2,
  items: 3,
  volumes: 4,
  verdict: 5,
} as const

/** Group-0 layout entries of the rectangle: five inputs, then the verdict it folds into. */
export function waterRectBindEntries(): GPUBindGroupLayoutEntry[] {
  const B = WATER_RECT_BINDING
  return [
    computeBufferEntry(B.frame, 'read-only-storage'),
    computeBufferEntry(B.keyed, 'read-only-storage'),
    computeBufferEntry(B.waterItems, 'read-only-storage'),
    computeBufferEntry(B.items, 'read-only-storage'),
    computeBufferEntry(B.volumes, 'read-only-storage'),
    computeBufferEntry(B.verdict, 'storage'),
  ]
}

/**
 * THE WATER PASS'S RECTANGLE, ON THE GPU (`includeWaterItem` of the CPU, its model in
 * `waterRect.fixture.ts`): one thread per water item the verdict says draws (`verdictWgsl.ts`).
 * Its surface rectangle is its local box, widened for single precision, enclosed under its pose,
 * projected (`projectWgsl.ts`); its backdrop's, the screen-space depth box the composite
 * reconstructs from, enclosed under the inverse projection, widened by the declared thickness taken
 * to the world by the pose's stretch bound (`waterStretch`) and projected again; its item rank is
 * its volume's (`VOLUME_ITEM`). An item whose geometry may not crop — no local box, a paged or line
 * or sprite surface, a non-finite world box, a non-affine pose — or whose enclosure is refused
 * covers the full target. Each bound folds into the verdict's unions with one `atomicMax` (minima stored
 * complemented): the union does not depend on the threads' order, and is the CPU's walk's.
 * Then one thread writes what the pass draws from the unions (`argsWgsl.ts`).
 */
export const WATER_RECT_SHADER = wgslProgram(
  `@group(0) @binding(${WATER_RECT_BINDING.frame}) var<storage,read> frame:array<u32>;
@group(0) @binding(${WATER_RECT_BINDING.keyed}) var<storage,read> keyed:array<u32>;
@group(0) @binding(${WATER_RECT_BINDING.waterItems}) var<storage,read> waterItems:array<u32>;
@group(0) @binding(${WATER_RECT_BINDING.items}) var<storage,read> items:array<u32>;
@group(0) @binding(${WATER_RECT_BINDING.volumes}) var<storage,read> volumes:array<u32>;
@group(0) @binding(${WATER_RECT_BINDING.verdict}) var<storage,read_write> verdict:array<atomic<u32>>;
/** The full target into the union at \`at\`. */
fn waterFull(at:u32){
 atomicMax(&verdict[at],0xffffffffu);
 atomicMax(&verdict[at+1u],0xffffffffu);
 atomicMax(&verdict[at+2u],frame[FRAME_WIDTH]);
 atomicMax(&verdict[at+3u],frame[FRAME_HEIGHT]);
}
/** A rectangle of whole pixels into the union at \`at\`. */
fn waterFold(at:u32,rect:array<vec2u,4>){
 atomicMax(&verdict[at],~dToU32(rect[0]));
 atomicMax(&verdict[at+1u],~dToU32(rect[1]));
 atomicMax(&verdict[at+2u],dToU32(rect[2]));
 atomicMax(&verdict[at+3u],dToU32(rect[3]));
}
/** Sixteen single-precision words from \`at\` of \`frame\`, as doubles. */
fn frameMatrix(at:u32)->array<vec2u,16>{
 var m:array<vec2u,16>;
 for(var k=0u;k<16u;k++){m[k]=fromF32(frame[at+k]);}
 return m;
}
/** Whether item \`item\`'s rectangle may crop: a local box, its own triangles, a finite world box
 *  and an affine pose \`pose\`. */
fn waterCrops(rank:u32,item:u32,pose:array<vec2u,16>)->bool{
 let at=item*KEY_RECORD_WORDS;
 if(waterItems[rank*WATER_ITEM_WORDS+WATER_ITEM_CROPS]==0u){return false;}
 if((keyed[at+KEY_FLAGS]&KEY_HAS_BOX)==0u){return false;}
 for(var k=0u;k<6u;k++){if(!dIsFinite(keyedDouble(at+2u*k))){return false;}}
 let last=pose[15];
 return dIsZero(pose[3])&&dIsZero(pose[7])&&dIsZero(pose[11])&&last.x==D_ONE.x&&last.y==D_ONE.y;
}
/** Water item \`rank\` (zero-based) folded into the surface and backdrop unions. */
fn includeWaterItem(rank:u32){
 let base=rank*WATER_ITEM_WORDS;
 let item=volumes[rank*${VOLUME_WORDS}u+${VOLUME_ITEM}u];
 var pose:array<vec2u,16>;
 for(var k=0u;k<16u;k++){pose[k]=fromF32(items[item*${BLEND_ITEM_WORDS}u+${BLEND_ITEM_WORLD}u+k]);}
 var local:array<vec2u,6>;
 for(var k=0u;k<6u;k++){local[k]=vec2u(waterItems[base+2u*k+1u],waterItems[base+2u*k]);}
 var world=local;
 world[0]=dNan();
 if(waterCrops(rank,item,pose)){world=waterEnclose(waterWiden(local,D_ZERO),pose);}
 let projection=frameMatrix(FRAME_PROJECTION);
 var rect:array<vec2u,4>;
 rect[0]=dNan();
 if(!dIsNan(world[0])){rect=waterProject(world,projection);}
 if(dIsNan(rect[0])){
  waterFull(VERDICT_SURFACE);
  waterFull(VERDICT_BACKDROP);
  return;
 }
 waterFold(VERDICT_SURFACE,rect);
 let thickness=fromF32(volumes[rank*${VOLUME_WORDS}u+2u]);
 if(!dIsFinite(thickness)){
  waterFull(VERDICT_BACKDROP);
  return;
 }
 let width=dFromU32(frame[FRAME_WIDTH]);
 let height=dFromU32(frame[FRAME_HEIGHT]);
 var ndc=projectNdc;
 ndc[0]=dMathMin(ndc[0],dSub(dDiv(dMul(D_TWO,rect[0]),width),D_ONE));
 ndc[1]=dMathMin(ndc[1],dSub(D_ONE,dDiv(dMul(D_TWO,rect[3]),height)));
 ndc[3]=dMathMax(ndc[3],dSub(dDiv(dMul(D_TWO,rect[2]),width),D_ONE));
 ndc[4]=dMathMax(ndc[4],dSub(D_ONE,dDiv(dMul(D_TWO,rect[1]),height)));
 let reconstructed=waterEnclose(waterWiden(ndc,D_ZERO),frameMatrix(FRAME_INVERSE));
 if(dIsNan(reconstructed[0])){
  waterFull(VERDICT_BACKDROP);
  return;
 }
 let reach=dMul(dMul(dMathMax(D_ZERO,thickness),waterStretch(pose)),D_THICKNESS_GUARD);
 let back=waterProject(waterWiden(reconstructed,reach),projection);
 if(dIsNan(back[0])){
  waterFull(VERDICT_BACKDROP);
  return;
 }
 waterFold(VERDICT_BACKDROP,back);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn boundWaterItems(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let rank=flatIndex(id,n,WORKGROUP_THREADS);
 if(rank>=frame[FRAME_WATERS]){return;}
 if(atomicLoad(&verdict[VERDICT_WATER_DRAWS+rank])==0u){return;}
 atomicAdd(&verdict[VERDICT_DRAWN],1u);
 includeWaterItem(rank);
}
`,
  [
    WATER_ARGS_WGSL,
    WATER_DOUBLES_WGSL,
    WATER_ENCLOSE_WGSL,
    WATER_PROJECT_WGSL,
    WATER_ITEM_WGSL,
    KEYED_WGSL,
    FRAME_HEAD_WGSL,
    VERDICT_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    dDiv,
    dMul,
    dSub,
    dIsNan,
    dIsZero,
    dNan,
    dMathMax,
    dMathMin,
    dFromU32,
    dIsFinite,
    dToU32,
    fromF32,
  ],
)
