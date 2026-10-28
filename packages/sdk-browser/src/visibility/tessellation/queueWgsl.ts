import { wgslBlock, wgslFn, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { MATERIAL_RANK_MASK } from '../types.ts'
import {
  DISPLACEMENT_RECORD,
  DISPLACEMENT_WORDS,
} from '../../materials/table/displacementRecord.ts'
import { TESS_UNIFORM } from './uniform.ts'
import {
  ARG_LISTED,
  ARG_OCCLUDED,
  ARG_QUEUE,
  ARG_VISIBLE,
  LOSS_QUEUE,
  LOSS_OCCLUDED,
  LOSS_VISIBLE,
  OCCLUSION_MAIN,
  PATCH_WORDS,
  VISIBLE_LISTS,
} from './contract.ts'
import {
  PATTERN_WGSL,
  unpackCorner,
  packCorner,
  patchBarycentrics,
  patternOf,
  sortedFactors,
  tessWord,
  tessWordPlain,
} from './patchWgsl.ts'

/** The structure of the uniform `tu` (`TESS_UNIFORM`), and `tw`, the read of the `tess` buffer: the
 *  part of the program the passes that move no patch — the levels' and the dicing's arguments —
 *  share with the ones that do. */
export const TESS_STATE_WGSL = wgslBlock('TESS_STATE_WGSL', [tessWord], TESS_UNIFORM.wgsl)
/** The same where `tess` is a plain read-only array (`tessWordPlain`): the shadow maps' dicing's. */
const TESS_STATE_PLAIN_WGSL = wgslBlock('TESS_STATE_PLAIN_WGSL', [tessWordPlain], TESS_UNIFORM.wgsl)

/** The four words from a word, by the `tw` of `state`. */
const tessWord4 = (state: WgslDecl) =>
  wgslFn(
    'tw4',
    [state],
    'fn tw4(at:u32)->vec4u{return vec4u(tw(at),tw(at+1u),tw(at+2u),tw(at+3u));}',
  )
/** The four words from word `at` of the `tess` buffer, where it is written atomically (`tw`, `TESS_STATE_WGSL`). */
export const TESS_WORD4_WGSL = tessWord4(TESS_STATE_WGSL)
/** What a program reads of the `tess` buffer, by the `tw` of `state`: the patch at a word and the record of the
 *  displacement a row's surface names (`displacementOf`), its rank's words of the records' region, which starts at `tu.dispBase`. */
const tessReadWgsl = (name: string, state: WgslDecl) =>
  wgslBlock(
    name,
    [tessWord4(state)],
    `${DISPLACEMENT_RECORD.wgsl}
fn displacementOf(page:PageInfo)->DisplacementRecord{
 let at=tu.dispBase+(page.material&${MATERIAL_RANK_MASK}u)*${DISPLACEMENT_WORDS}u;
 return DisplacementRecord(bitcast<vec4f>(tw4(at)),bitcast<vec4f>(tw4(at+4u)),tw4(at+8u),bitcast<vec4f>(tw4(at+12u)),bitcast<vec4f>(tw4(at+16u)));
}
/** The patch at word \`at\`. */
fn loadPatch(at:u32)->vec4u{return tw4(at);}`,
  )
const TESS_READ_WGSL = tessReadWgsl('TESS_READ_WGSL', TESS_STATE_WGSL)
/** The reads of a program whose `tess` is plain read-only (`tessWordPlain`): the shadow maps'
 *  dicing's. */
export const TESS_READ_PLAIN_WGSL = tessReadWgsl('TESS_READ_PLAIN_WGSL', TESS_STATE_PLAIN_WGSL)

/**
 * The patches the passes hand on, as the shaders write and read them. A patch is four words: the
 * visibility identifier of its source triangle (`page.packedBase | triangle`), then the barycentrics
 * of its three corners on that triangle (`packCorner`). The splitting queue holds the patches
 * of every level one after another; the visible list the ones that need no more cutting.
 *
 * The program declares the `tess` buffer (`array<atomic<u32>>`) and the uniforms `uni` and `tu`, whose
 * `args`, `queue` and `visible` are the word offsets of its pass's regions of the buffer (`tessLayout`).
 */
/**
 * Keeping patch `p` for the post pass (`occludePatch`), the patches the main pass's occlusion test hid, in the region that holds them: written by
 * `store` (WGSL statements over `slot` and `p`) where the region has room (`tu.maxOccluded`), counted where it has none. Only the main pass keeps;
 * the post pass drops what it hides. The image's region is a buffer of its own, the shadow maps' a region of `tess`.
 */
export const occludePatchText = (store: string) => `fn occludePatch(p:vec4u){
 if(tu.occlusion!=${OCCLUSION_MAIN}u){return;}
 let slot=atomicAdd(&tess[tu.args+${ARG_OCCLUDED}u],1u);
 if(slot<tu.maxOccluded){${store}}
 else{atomicAdd(&tess[tu.lost+${LOSS_OCCLUDED}u],1u);}
}`
/**
 * The post pass's resume, entry point `entry`: a thread a patch the main pass's occlusion test hid (`ARG_OCCLUDED` of the main pass's state, at most
 * `maxOccluded`), dispatched indirectly by the resume's arguments, queued as the seeding queues a triangle to be judged again against this frame's
 * pyramid. `load` is the WGSL expression of the patch kept at `slot`.
 */
export const resumeKernelText = (entry: string, load: string) =>
  `@compute @workgroup_size(WORKGROUP_THREADS) fn ${entry}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=min(tw(tu.mainArgs+${ARG_OCCLUDED}u),tu.maxOccluded)){return;}
 queuePatch(${load});
}`

const listPlace = (list: (typeof VISIBLE_LISTS)[number]) =>
  list.fromEnd ? 'tu.maxVisible-1u-i' : 'i'
/** Where a layer's visible patches lie (`VISIBLE_LISTS`): the word of the chain's state that counts them, and the slot of the region the `i`-th
 *  of them is kept at. The program declares `tu`. */
export const TESS_LISTS_WGSL = wgslBlock(
  'TESS_LISTS_WGSL',
  [],
  `fn listCounter(layer:u32)->u32{return select(${VISIBLE_LISTS[0].counter}u,${VISIBLE_LISTS[1].counter}u,layer==1u);}
fn listSlot(layer:u32,i:u32)->u32{return select(${listPlace(VISIBLE_LISTS[0])},${listPlace(VISIBLE_LISTS[1])},layer==1u);}`,
)

export const QUEUE_WGSL = wgslBlock(
  'QUEUE_WGSL',
  [TESS_READ_WGSL, TESS_LISTS_WGSL],
  `/** Writes patch \`p\` at word \`at\`. */
fn storePatch(at:u32,p:vec4u){
 atomicStore(&tess[at],p.x);atomicStore(&tess[at+1u],p.y);atomicStore(&tess[at+2u],p.z);atomicStore(&tess[at+3u],p.w);
}
/** Asks the splitting queue for a place for patch \`p\`: written where there is one, counted
 *  where there is none — the count past the capacity is what the image lost. */
fn queuePatch(p:vec4u){
 let slot=atomicAdd(&tess[tu.args+${ARG_QUEUE}u],1u);
 if(slot<tu.maxCandidate){storePatch(tu.queue+slot*${PATCH_WORDS}u,p);}
 else{atomicAdd(&tess[tu.lost+${LOSS_QUEUE}u],1u);}
}
/** The same for the pass's visible list: the image's one list takes one count; the shadow maps' layers (\`tu.layered\`) each their own run
 *  of it (\`VISIBLE_LISTS\`), the room reserved first for both together (\`ARG_LISTED\`, a count past it the loss), so that the two runs never meet. */
fn listVisible(p:vec4u,layer:u32){
 if(tu.layered==0u){
  let slot=atomicAdd(&tess[tu.args+${ARG_VISIBLE}u],1u);
  if(slot>=tu.maxVisible){atomicAdd(&tess[tu.lost+${LOSS_VISIBLE}u],1u);return;}
  storePatch(tu.visible+slot*${PATCH_WORDS}u,p);
  return;
 }
 if(atomicAdd(&tess[tu.args+${ARG_LISTED}u],1u)>=tu.maxVisible){atomicAdd(&tess[tu.lost+${LOSS_VISIBLE}u],1u);return;}
 let slot=atomicAdd(&tess[tu.args+listCounter(layer)],1u);
 storePatch(tu.visible+listSlot(layer,slot)*${PATCH_WORDS}u,p);
}`,
)

/**
 * A patch cut by the pattern of the edge factors `requested`: its corners' barycentrics (`parent`,
 * the columns) as the pattern's corners are numbered after the sort of the factors
 * (`sortedFactors`), then each of the pattern's triangles as a child patch, its corners the
 * pattern's vertices carried onto the source triangle; handed to `queuePatch`, but for one with a
 * repeated corner and, where `skipSame`, one that is the patch itself.
 */
export const CHILDREN_WGSL = wgslBlock(
  'CHILDREN_WGSL',
  [QUEUE_WGSL, PATTERN_WGSL, sortedFactors, patternOf, patchBarycentrics, packCorner, unpackCorner],
  `fn queueChildren(id:u32,parent:mat3x3f,requested:vec3f,skipSame:bool){
 let s=sortedFactors(requested);
 let pattern=patternAt(patternOf(s.factors,s.flip));
 let ordered=mat3x3f(parent[s.corners.x],parent[s.corners.y],parent[s.corners.z]);
 let own=vec3u(packCorner(ordered[0]),packCorner(ordered[1]),packCorner(ordered[2]));
 for(var t=0u;t<patternTriangles(pattern);t++){
  let c=patternCorners(pattern,t);
  let e=vec3u(
   packCorner(patchBarycentrics(ordered[0],ordered[1],ordered[2],patternVertex(pattern,c.x))),
   packCorner(patchBarycentrics(ordered[0],ordered[1],ordered[2],patternVertex(pattern,c.y))),
   packCorner(patchBarycentrics(ordered[0],ordered[1],ordered[2],patternVertex(pattern,c.z))));
  if(e.x==e.y||e.y==e.z||e.z==e.x){continue;}
  if(skipSame&&all(e==own)){continue;}
  queuePatch(vec4u(id,e.x,e.y,e.z));
 }
}`,
)
