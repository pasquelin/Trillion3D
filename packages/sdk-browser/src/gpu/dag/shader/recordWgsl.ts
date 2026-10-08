import { SELECTION_LIST_CAP } from '../layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitIsSet, bitWord, ceilDiv } from '../../../../../math/src/wgsl/integer.ts'

/**
 * Cold record of a cluster, the working table and page residency, read by word in one buffer.
 *
 * Cone, box and residency in a forty-eight-byte structure would be read whole by the five frame
 * passes, most of the time to take only a flag. The buffer is an array of words: the working
 * table first — one word per page, its placement —, then the three residency bit sets — one word
 * for thirty-two pages, hence one cache line for five hundred —, then the key column (`../evict.ts`),
 * then the cold records, one per UNIQUE cluster, which the opening pass reads cone and box from.
 *
 * A page reaches its hot and cold records through `recordOf`: its index plus its placement's
 * shift, the third frame word (`../worlds.ts`). Ranks are those of `../layout.ts`, sole source of
 * the layout: the oracle rereads them through `../records.fixture.ts`, which keeps it bit-for-bit on the
 * shader.
 */
export const DAG_RECORD_WGSL = wgslBlock(
  'DAG_RECORD_WGSL',
  [ceilDiv, bitWord, bitIsSet],
  `const COLD:u32=13u;
fn pageWorld(i:u32)->u32{return coldAt(i);}
/** Shared record of page \`i\` of primitive \`w\`: a wrapping add, as \`recordOf\` on the host. */
fn recordOf(i:u32,w:u32)->u32{return i+bitcast<u32>(frames[rowOf(w)*FRAME+6u].z);}
fn residentWords()->u32{return ceilDiv(views[0u].clusterCount,32u);}
fn poolBase()->u32{return views[0u].clusterCount+2u*residentWords();}
/** The pool's list holds \`selectionListCap\` pages (\`../layout.ts\`), whatever the readout's cap. */
fn keyBase()->u32{return poolBase()+1u+min(views[0u].clusterCount,${SELECTION_LIST_CAP}u);}
fn coldBase()->u32{return keyBase()+views[0u].clusterCount;}
fn coldF(r:u32,k:u32)->f32{return bitcast<f32>(coldAt(coldBase()+r*COLD+k));}
fn coneOf(r:u32)->vec4f{return vec4f(coldF(r,0u),coldF(r,1u),coldF(r,2u),coldF(r,3u));}
fn boxMin(r:u32)->vec3f{return vec3f(coldF(r,4u),coldF(r,5u),coldF(r,6u));}
fn hasBox(r:u32)->f32{return coldF(r,7u);}
fn boxMax(r:u32)->vec3f{return vec3f(coldF(r,8u),coldF(r,9u),coldF(r,10u));}
/** Cluster triangles, read as a whole word: frame totals accumulate them. */
fn trianglesOf(r:u32)->u32{return coldAt(coldBase()+r*COLD+12u);}
/** The cut rule's two bit sets follow the working table, one word for thirty-two pages:
 *  \`resident(c)\` then \`resident(childGroup(c))\` (\`../../../page/cut/readiness.ts\`). */
fn isResident(i:u32)->bool{return bitIsSet(coldAt(views[0u].clusterCount+bitWord(i)),i);}
fn childResident(i:u32)->bool{return bitIsSet(coldAt(views[0u].clusterCount+residentWords()+bitWord(i)),i);}
`,
)
