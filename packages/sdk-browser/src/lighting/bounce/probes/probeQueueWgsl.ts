import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'

/** Words of a queue entry: the slot, the level and the downsample flag packed in one, then the three
 *  coordinates of the cell the probe carries (`../pool/poolWgsl.ts` writes them). */
export const PROBE_QUEUE_WORDS = 4

/** The packing of a queue entry's first word: the slot in the low 16 bits, the level above it, and a bit set where the probe's
 *  radiance map is traced at half its side whatever its distance. */
const QUEUE = {
  SLOT_MASK: 0xffff,
  LEVEL_SHIFT: 16,
  LEVEL_MASK: 0xff,
  DOWNSAMPLED: 1 << 24,
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
  })}
/** The first word of a queue entry for the probe of \`slot\`, at \`level\`, \`downsampled\` when its map is traced at half its side. */
fn packQueued(slot:u32,level:u32,downsampled:bool)->u32{
 return slot|(level<<QUEUE_LEVEL_SHIFT)|select(0u,QUEUE_DOWNSAMPLED,downsampled);
}`,
)

/**
 * Queue entry `entry`, as the radiance cache's kernels read it (`../cache/`): its slot in the pool, its level, the cell the probe
 * carries, whether its map is traced at half its side, and whether the level exists.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [BOUNCE_GRID_STRUCTS_WGSL, QUEUE_WORD_WGSL],
  `struct QueuedProbe{level:u32,slot:u32,cell:vec3i,downsampled:bool,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let at=entry*${PROBE_QUEUE_WORDS}u;
 let packed=probeQueue[at];
 let level=(packed>>QUEUE_LEVEL_SHIFT)&QUEUE_LEVEL_MASK;
 let slot=packed&QUEUE_SLOT_MASK;
 if(level>=bounce.counts.y){return QueuedProbe(level,slot,vec3i(0),false,false);}
 let cell=bitcast<vec3i>(vec3u(probeQueue[at+1u],probeQueue[at+2u],probeQueue[at+3u]));
 return QueuedProbe(level,slot,cell,(packed&QUEUE_DOWNSAMPLED)!=0u,true);
}`,
)
