import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  SHADOW_TABLE_ENTRIES,
  SHADOW_TABLE_STRIDE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** A page's fields in the GPU pool, one array of `pages` words each after the counts: the entry
 *  it maps (−1 free) and the frame it was last asked in first, the words a snapshot reads back. */
export const POOL_FIELDS = ['owner', 'requested', 'rank', 'view', 'x', 'y', 'generation'] as const;
/** The counts the allocation keeps, before the fields: what a snapshot reads back with them. */
export const POOL_COUNTS = ['needs', 'candidates', 'allocated', 'refused'] as const;
/** The index of each field and count of the pool (`POOL_FIELDS`, `POOL_COUNTS`), in the WGSL. */
const fieldConsts = POOL_FIELDS.map((f, i) => `const POOL_${f.toUpperCase()}:u32=${i}u;`).join('');
const countConsts = POOL_COUNTS.map((c, i) => `const COUNT_${c.toUpperCase()}:u32=${i}u;`).join('');

/** The GPU pool as both passes read it, and what reads its fields and entries. */
export const SHADOW_POOL_WGSL = `
${fieldConsts}${countConsts}
const PAGE_MAPPED:u32=${PAGE_MAPPED}u;
const PAGE_INDEX_MASK:u32=${PAGE_INDEX_MASK}u;
const ENTRY_MASK:u32=${SHADOW_TABLE_ENTRIES - 1}u;
const SHADOW_TABLE_STRIDE:u32=${SHADOW_TABLE_STRIDE}u;`;
