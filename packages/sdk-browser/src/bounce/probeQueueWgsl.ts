import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from './gridWgsl.ts'

/** Words of a queue entry: the level's rank, then the cell it carries (`schedule.ts`). */
export const PROBE_QUEUE_WORDS = 4

/**
 * Queue entry `entry`, as both the update and the snapshot's follow-up read it (`probeWgsl.ts`): its
 * level, its rank in the level, the cell that rank carries — the scheduler's, which inverted the
 * toroidal storage once to ask the occupancy (`schedule.ts`) —, the probe's first texel, and whether
 * the level exists. One text, so the texels the snapshot copies are the ones the update wrote.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [BOUNCE_GRID_HEAD_WGSL],
  `struct QueuedProbe{level:u32,rank:u32,cell:vec3i,probe:vec3u,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let at=entry*${PROBE_QUEUE_WORDS}u;
 let packed=probeQueue[at];
 let perLevel=max(bounce.counts.z,1u);
 let level=packed/perLevel;
 if(level>=bounce.counts.y){return QueuedProbe(level,0u,vec3i(0),vec3u(0u),false);}
 let cell=bitcast<vec3i>(vec3u(probeQueue[at+1u],probeQueue[at+2u],probeQueue[at+3u]));
 return QueuedProbe(level,packed%perLevel,cell,probeOf(level,cell),true);
}`,
)
