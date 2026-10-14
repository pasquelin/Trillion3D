import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from './gridWgsl.ts'

/**
 * Queue entry `entry`, as both the update and the snapshot's follow-up read it (`probeWgsl.ts`): its
 * level, its rank in the level, the cell that rank carries — the inverse of toroidal storage (`probeWrap`), in
 * `[base, base + side)` —, the probe's first texel, and whether the level exists. One text, so the
 * texels the snapshot copies are the ones the update wrote.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [BOUNCE_GRID_HEAD_WGSL],
  `struct QueuedProbe{level:u32,rank:u32,cell:vec3i,probe:vec3u,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let packed=probeQueue[entry];
 let perLevel=max(bounce.counts.z,1u);
 let level=packed/perLevel;
 if(level>=bounce.counts.y){return QueuedProbe(level,0u,vec3i(0),vec3u(0u),false);}
 let rank=packed%perLevel;
 let base=vec3i(bounce.levels[level].base.xyz);
 let ranked=vec3i(vec3u(rank%bounce.counts.x,(rank/bounce.counts.x)%bounce.counts.x,rank/(bounce.counts.x*bounce.counts.x)));
 let cell=base+vec3i(probeWrap(ranked-base));
 return QueuedProbe(level,rank,cell,probeOf(level,cell),true);
}`,
)
