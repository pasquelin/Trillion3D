import { COLD_HAS_BOX, COLD_MAX, COLD_MIN, COLD_TRIANGLES, COLD_WORDS } from '../layout.ts'
import { RECORD_SHIFT_WORD } from '../frameTable.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitIsSet, bitWord, ceilDivWgsl } from '../../../../../math/src/wgsl/integer.ts'

/**
 * Cold record of a cluster and page residency, read by word in one buffer.
 *
 * Box and residency in one structure would be read whole by the five frame passes, most of the
 * time to take only a flag. The buffer is an array of words: the residency bit sets first — one
 * word for thirty-two pages, hence one cache line for five hundred —, then the cold records, one
 * per UNIQUE cluster, which the cluster tests read the box and the triangles from. No word per
 * page: a page's placement travels in the entries that carry it (`levelWgsl.ts`).
 *
 * A page reaches its hot and cold records through `recordOf`: its index plus its placement's
 * shift, its frame row's `RECORD_SHIFT_WORD` (`../frameTable.ts`). Ranks are those of `../layout.ts`, sole source of
 * the layout: the oracle rereads them through `../records.fixture.ts`, which keeps it bit-for-bit on the
 * shader. The bases below are the WGSL twins of `../layout.ts`' own (`residentWords` to `coldBase`):
 * they read the counts off the uniforms.
 */
/** Cold words `first` to `first + n - 1` of record `r`, as a vector's components. */
const coldWords = (first: number, n: number) =>
  Array.from({ length: n }, (_, k) => `coldF(r,${first + k}u)`).join(',')

export const DAG_RECORD_WGSL = wgslBlock(
  'DAG_RECORD_WGSL',
  [ceilDivWgsl, bitWord, bitIsSet],
  `${wgslConsts({ COLD: COLD_WORDS })}
/** Shared record of page \`i\` of primitive \`w\`: a wrapping add, as \`recordOf\` on the host. */
fn recordOf(i:u32,w:u32)->u32{return i+framesWord(w,${RECORD_SHIFT_WORD}u);}
fn residentWords()->u32{return ceilDiv(views[0u].clusterCount,32u);}
fn coldBase()->u32{return 2u*residentWords();}
fn coldF(r:u32,k:u32)->f32{return bitcast<f32>(coldAt(coldBase()+r*COLD+k));}
fn boxMin(r:u32)->vec3f{return vec3f(${coldWords(COLD_MIN, 3)});}
fn hasBox(r:u32)->f32{return coldF(r,${COLD_HAS_BOX}u);}
fn boxMax(r:u32)->vec3f{return vec3f(${coldWords(COLD_MAX, 3)});}
/** Cluster triangles, read as a whole word: frame totals accumulate them. */
fn trianglesOf(r:u32)->u32{return coldAt(coldBase()+r*COLD+${COLD_TRIANGLES}u);}
/** The cut rule's two bit sets open the table, one word for thirty-two pages:
 *  \`resident(c)\` then \`resident(childGroup(c))\` (\`../../../page/cut/readiness.ts\`). */
fn isResident(i:u32)->bool{return bitIsSet(coldAt(bitWord(i)),i);}
fn childResident(i:u32)->bool{return bitIsSet(coldAt(residentWords()+bitWord(i)),i);}
`,
)
