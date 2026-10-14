import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { mixWord } from '../../../../math/src/wgsl/sampling.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'

/** Words ahead of the map's keys in its buffer: its slot count (`rowMapGpu.ts`). */
export const ROW_MAP_HEAD = 1

/**
 * THE PAGE→ROW MAP AS THE GPU READS IT: the row cache's own open-addressed table
 * (`../../page/cut/sparseInts.ts`, `pageState.ts`), its two arrays uploaded by the slots it wrote
 * (`rowMapGpu.ts`) — the same table, so the same probe: home `mixWord(page)` masked by the slot
 * count, then the next slot until the key or an empty one (`-1`). Loaded under half, a probe reads
 * about a slot and a half; the loop is bounded by the slots. A value is the row plus one.
 *
 * The program that holds it binds `rowMap:array<u32>`: the slot count, the keys, then the values.
 */
export const ROW_MAP_WGSL = wgslBlock(
  'ROW_MAP_WGSL',
  [mixWord, NO_INDEX],
  `/** The visibility row packed page \`page\` holds, NO_INDEX for none. */
fn rowOfPage(page:u32)->u32{
 let slots=rowMap[0u];
 if(slots==0u){return NO_INDEX;}
 let mask=slots-1u;var at=mixWord(page)&mask;
 for(var k=0u;k<slots;k++){
  let key=rowMap[${ROW_MAP_HEAD}u+at];
  if(key==page){return rowMap[${ROW_MAP_HEAD}u+slots+at]-1u;}
  if(key==NO_INDEX){return NO_INDEX;}
  at=(at+1u)&mask;
 }
 return NO_INDEX;
}
`,
)
