import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
  SHADOW_TABLE_STRIDE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** A page's fields in the GPU pool, one array of `pages` words each after the counts: the entry
 *  it maps (−1 free) and the frame it was last asked in first, the words a snapshot reads back;
 *  last, which draw its entry's depth came from (`DRAWN_*`). */
export const POOL_FIELDS = [
  'owner',
  'requested',
  'rank',
  'view',
  'x',
  'y',
  'generation',
  'drawnBy',
] as const;
/** Whose draw a page holds for its entry: the host's (`pool.drew`), none yet — mapped by the GPU
 *  —, or the GPU's own (`freshWgsl.ts`), which the host has not seen. */
export const DRAWN_HOST = 0,
  DRAWN_NONE = 1,
  DRAWN_GPU = 2;
/** The counts the allocation keeps, before the fields: what a snapshot reads back with them. Each
 *  frame's allocation clears those before `listings`, the pages every frame since the pool's seed
 *  listed (`listDraw`): a snapshot read after a lost one still shows that the GPU drew. */
export const POOL_COUNTS = [
  'needs',
  'candidates',
  'allocated',
  'refused',
  'drawn',
  'listings',
] as const;
/** The counts each frame's allocation starts from zero (`allocWgsl.ts`): all but `listings`. */
export const POOL_FRAME_COUNTS = POOL_COUNTS.indexOf('listings');
/** The index of each field and count of the pool (`POOL_FIELDS`, `POOL_COUNTS`), in the WGSL. */
const fieldConsts = POOL_FIELDS.map((f, i) => `const POOL_${f.toUpperCase()}:u32=${i}u;`).join('');
const countConsts = POOL_COUNTS.map((c, i) => `const COUNT_${c.toUpperCase()}:u32=${i}u;`).join('');

/** The GPU pool as every pass reads it — its counts, then one array per field —, where a page's
 *  field lies (\`poolAt\`: each pass binds \`shadowPool\` and says its pages, \`shadowPoolPages\`),
 *  and its counts' atomics. */
export const SHADOW_POOL_WGSL = `
${fieldConsts}${countConsts}
struct ShadowPool{counts:array<atomic<u32>,${POOL_COUNTS.length}>,pages:array<i32>,}
fn poolAt(field:u32,p:u32)->u32{return field*shadowPoolPages()+p;}
fn countOne(i:u32){atomicAdd(&shadowPool.counts[i],1u);}
fn countNext(i:u32)->u32{return atomicAdd(&shadowPool.counts[i],1u);}
fn countRead(i:u32)->u32{return atomicLoad(&shadowPool.counts[i]);}
fn countClear(i:u32){atomicStore(&shadowPool.counts[i],0u);}
const PAGE_MAPPED:u32=${PAGE_MAPPED}u;
const PAGE_VALID:u32=${PAGE_VALID}u;
const DRAWN_HOST:i32=${DRAWN_HOST};
const DRAWN_NONE:i32=${DRAWN_NONE};
const DRAWN_GPU:i32=${DRAWN_GPU};
const PAGE_INDEX_MASK:u32=${PAGE_INDEX_MASK}u;
const ENTRY_MASK:u32=${SHADOW_TABLE_ENTRIES - 1}u;
const SHADOW_TABLE_STRIDE:u32=${SHADOW_TABLE_STRIDE}u;`;

/** Page \`p\` joins the frame's draw list (\`freshWgsl.ts\`): mapped, not drawn since. The pass that
 *  lists binds \`drawList\`. */
export const SHADOW_DRAW_LIST_WGSL = `fn listDraw(p:u32){drawList[countNext(COUNT_DRAWN)]=p;countOne(COUNT_LISTINGS);}`;
