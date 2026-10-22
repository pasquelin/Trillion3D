import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../gridWgsl.ts'

/** Words of a queue entry: the slot, the level and the first-trace flag packed in one, then the three
 *  coordinates of the cell the probe carries (`../schedule.ts`). */
export const PROBE_QUEUE_WORDS = 4

/** The packing of a queue entry's first word: the slot in the low 16 bits, the level above it, and a
 *  bit set where the trace is the probe's first for its cell. */
const QUEUE = { SLOT_MASK: 0xffff, LEVEL_SHIFT: 16, LEVEL_MASK: 0xff, FRESH: 1 << 24 } as const

/** The first word of a queue entry for the probe of `slot`, at `level`, `fresh` when it is its first trace. */
export const packQueued = (slot: number, level: number, fresh: boolean) =>
  (slot | (level << QUEUE.LEVEL_SHIFT) | (fresh ? QUEUE.FRESH : 0)) >>> 0

/**
 * Queue entry `entry`, as both the update and the snapshot's follow-up read it (`probeWgsl.ts`): its
 * slot in the pool, its level, the cell the probe carries, the probe's first texel, whether it is
 * its first trace (nothing it holds is kept), and whether the level exists. One text, so the texels
 * the snapshot copies are the ones the update wrote.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [BOUNCE_GRID_HEAD_WGSL],
  `${wgslConsts({
    QUEUE_SLOT_MASK: QUEUE.SLOT_MASK,
    QUEUE_LEVEL_SHIFT: QUEUE.LEVEL_SHIFT,
    QUEUE_LEVEL_MASK: QUEUE.LEVEL_MASK,
    QUEUE_FRESH: QUEUE.FRESH,
  })}
struct QueuedProbe{level:u32,slot:u32,cell:vec3i,probe:vec3u,fresh:bool,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let at=entry*${PROBE_QUEUE_WORDS}u;
 let packed=probeQueue[at];
 let level=(packed>>QUEUE_LEVEL_SHIFT)&QUEUE_LEVEL_MASK;
 let slot=packed&QUEUE_SLOT_MASK;
 if(level>=bounce.counts.y){return QueuedProbe(level,slot,vec3i(0),vec3u(0u),false,false);}
 let cell=bitcast<vec3i>(vec3u(probeQueue[at+1u],probeQueue[at+2u],probeQueue[at+3u]));
 return QueuedProbe(level,slot,cell,poolProbe(slot),(packed&QUEUE_FRESH)!=0u,true);
}`,
)
