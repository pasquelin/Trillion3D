import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'

/** Words of a queue entry: the slot, the level, the downsample flag and the probe's rank packed in one, then the three
 *  coordinates of the cell the probe carries and the three floats of its offset from the cell's place (`../pool/poolWgsl.ts` writes them). */
export const PROBE_QUEUE_WORDS = 7

/** The packing of a queue entry's first word: the slot in the low 16 bits, the level above it, a bit set where the probe's
 *  radiance map is traced at half its side whatever its distance, and above it the probe's rank (zero for the cell's own, an adaptive probe's otherwise). */
const QUEUE = {
  SLOT_MASK: 0xffff,
  LEVEL_SHIFT: 16,
  LEVEL_MASK: 0xff,
  DOWNSAMPLED: 1 << 24,
  RANK_SHIFT: 25,
  RANK_MASK: 3,
} as const

/** The packing of a queue entry's first word and the consts the readers unpack it by: one block, the pool that writes it
 *  (`packQueued`) and the kernels that read it (`QUEUED_PROBE_WGSL`) agree. */
export const QUEUE_WORD_WGSL = wgslBlock(
  'QUEUE_WORD_WGSL',
  [],
  `${wgslConsts({
    QUEUE_SLOT_MASK: QUEUE.SLOT_MASK,
    QUEUE_LEVEL_SHIFT: QUEUE.LEVEL_SHIFT,
    QUEUE_LEVEL_MASK: QUEUE.LEVEL_MASK,
    QUEUE_DOWNSAMPLED: QUEUE.DOWNSAMPLED,
    QUEUE_RANK_SHIFT: QUEUE.RANK_SHIFT,
    QUEUE_RANK_MASK: QUEUE.RANK_MASK,
  })}
/** The first word of a queue entry for the probe of \`slot\`, at \`level\`, \`downsampled\` when its map is traced at half its side, of the rank \`rank\`. */
fn packQueued(slot:u32,level:u32,downsampled:bool,rank:u32)->u32{
 return slot|(level<<QUEUE_LEVEL_SHIFT)|select(0u,QUEUE_DOWNSAMPLED,downsampled)|(rank<<QUEUE_RANK_SHIFT);
}`,
)

/**
 * Queue entry `entry`, as the radiance cache's kernels read it (`../cache/`): its slot in the pool, its level, the cell the probe
 * carries and its offset from the cell's place (`queuedPosition`: where the probe stands), its rank, whether its map is traced at half its side, and whether the level exists.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [BOUNCE_GRID_STRUCTS_WGSL, QUEUE_WORD_WGSL],
  `struct QueuedProbe{level:u32,slot:u32,cell:vec3i,downsampled:bool,valid:bool,offset:vec3f,rank:u32,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let at=entry*${PROBE_QUEUE_WORDS}u;
 let packed=probeQueue[at];
 let level=(packed>>QUEUE_LEVEL_SHIFT)&QUEUE_LEVEL_MASK;
 let slot=packed&QUEUE_SLOT_MASK;
 if(level>=bounce.counts.y){return QueuedProbe(level,slot,vec3i(0),false,false,vec3f(0.0),0u);}
 let cell=bitcast<vec3i>(vec3u(probeQueue[at+1u],probeQueue[at+2u],probeQueue[at+3u]));
 let offset=bitcast<vec3f>(vec3u(probeQueue[at+4u],probeQueue[at+5u],probeQueue[at+6u]));
 return QueuedProbe(level,slot,cell,(packed&QUEUE_DOWNSAMPLED)!=0u,true,offset,(packed>>QUEUE_RANK_SHIFT)&QUEUE_RANK_MASK);
}
/** Where the probe stands: its cell's place moved by its offset. */
fn queuedPosition(q:QueuedProbe)->vec3f{return probePosition(q.cell,bounce.levels[q.level].spacing)+q.offset;}`,
)
