import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * Queue entry `entry`, as both the update and the snapshot's follow-up read it (`probeWgsl.ts`): its
 * level, its rank in the level, the cell that rank carries — the inverse of toroidal storage, in
 * `[base, base + side)` —, the probe's first texel, and whether the level exists. One text, so the
 * texels the snapshot copies are the ones the update wrote.
 */
export const QUEUED_PROBE_WGSL = wgslBlock(
  'QUEUED_PROBE_WGSL',
  [],
  `struct QueuedProbe{level:u32,rank:u32,cell:vec3i,probe:vec3u,valid:bool,}
fn queuedProbe(entry:u32)->QueuedProbe{
 let packed=probeQueue[entry];
 let perLevel=max(bounce.counts.z,1u);
 let level=packed/perLevel;
 if(level>=bounce.counts.y){return QueuedProbe(level,0u,vec3i(0),vec3u(0u),false);}
 let rank=packed%perLevel;
 let side=i32(bounce.counts.x);
 let base=vec3i(bounce.levels[level].base.xyz);
 let ranked=vec3i(vec3u(rank%bounce.counts.x,(rank/bounce.counts.x)%bounce.counts.x,rank/(bounce.counts.x*bounce.counts.x)));
 let cell=base+(((ranked-base)%side)+side)%side;
 return QueuedProbe(level,rank,cell,probeOf(level,cell),true);
}`,
)
