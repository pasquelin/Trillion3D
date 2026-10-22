import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { MATERIAL_RANK_MASK } from '../types.ts'
import {
  DISPLACEMENT_RECORD,
  DISPLACEMENT_WORDS,
} from '../../materials/table/displacementRecord.ts'
import { TESS_UNIFORM } from './uniform.ts'
import { ARG_QUEUE, ARG_VISIBLE, PATCH_WORDS } from './contract.ts'
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
/** The same where `tess` is a plain read-only array (`tessWordPlain`): a vertex stage's. */
const TESS_STATE_PLAIN_WGSL = wgslBlock('TESS_STATE_PLAIN_WGSL', [tessWordPlain], TESS_UNIFORM.wgsl)

/** What a program reads of the `tess` buffer, by the `tw` of `state`: the four words from a word, the
 *  patch at a word, and the record of the displacement a row's surface names (`displacementOf`),
 *  its rank's words of the records' region, which starts at `tu.dispBase`. */
const tessReadWgsl = (name: string, state: WgslDecl) =>
  wgslBlock(
    name,
    [state],
    `${DISPLACEMENT_RECORD.wgsl}
/** The four words from word \`at\` of the \`tess\` buffer. */
fn tw4(at:u32)->vec4u{return vec4u(tw(at),tw(at+1u),tw(at+2u),tw(at+3u));}
fn displacementOf(page:PageInfo)->DisplacementRecord{
 let at=tu.dispBase+(page.material&${MATERIAL_RANK_MASK}u)*${DISPLACEMENT_WORDS}u;
 return DisplacementRecord(bitcast<vec4f>(tw4(at)),bitcast<vec4f>(tw4(at+4u)),tw4(at+8u),bitcast<vec4f>(tw4(at+12u)));
}
/** The patch at word \`at\`. */
fn loadPatch(at:u32)->vec4u{return tw4(at);}`,
  )
const TESS_READ_WGSL = tessReadWgsl('TESS_READ_WGSL', TESS_STATE_WGSL)
/** The reads of a program whose `tess` is plain read-only (`tessWordPlain`): the shadow maps'
 *  vertex stage's. */
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
export const QUEUE_WGSL = wgslBlock(
  'QUEUE_WGSL',
  [TESS_READ_WGSL],
  `/** Writes patch \`p\` at word \`at\`. */
fn storePatch(at:u32,p:vec4u){
 atomicStore(&tess[at],p.x);atomicStore(&tess[at+1u],p.y);atomicStore(&tess[at+2u],p.z);atomicStore(&tess[at+3u],p.w);
}
/** Asks the splitting queue for a place for patch \`p\`: written where there is one, counted
 *  where there is none — the count past the capacity is what the image lost. */
fn queuePatch(p:vec4u){
 let slot=atomicAdd(&tess[tu.args+${ARG_QUEUE}u],1u);
 if(slot<tu.maxCandidate){storePatch(tu.queue+slot*${PATCH_WORDS}u,p);}
}
/** The same for the pass's visible list. */
fn listVisible(p:vec4u){
 let slot=atomicAdd(&tess[tu.args+${ARG_VISIBLE}u],1u);
 if(slot<tu.maxVisible){storePatch(tu.visible+slot*${PATCH_WORDS}u,p);}
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
