import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { sinFromCos } from '../../../math/src/wgsl/geometry.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'

/** Bytes of workgroup memory every device holds (`maxComputeWorkgroupStorageSize`). */
const GUARANTEED_GROUP_BYTES = 16384
/** Bytes of workgroup memory a thread of the update holds: thirteen `vec3f` sums, 16 bytes each in
 *  an array, and one `vec2f` of travel. */
const BYTES_PER_THREAD = 13 * 16 + 8

/**
 * THE PROBE UPDATE'S GROUP (`probeWgsl.ts`): one probe a workgroup, one thread a ray — its width
 * is the probe's rays (`raysPerProbe`), never the dispatch width other kernels tune —, each
 * thread's sums gathered by halves in workgroup memory. So the width is a power of two, and its
 * sums fit the memory every device holds; a setting past either is refused here, at load.
 */
const PROBE_THREADS = BOUNCE_SETTINGS.raysPerProbe
if (
  PROBE_THREADS & (PROBE_THREADS - 1) ||
  PROBE_THREADS * BYTES_PER_THREAD > GUARANTEED_GROUP_BYTES
)
  throw new RangeError(`raysPerProbe ${PROBE_THREADS}: a power of two whose sums fit 16 KiB`)

/** The group's width — the probe's rays, one a thread —, its partial sums — nine basis accumulators, four of distance, the
 *  travel and the rays that answered —, and the direction of a ray. */
export const PROBE_GROUP_WGSL = wgslBlock(
  'PROBE_GROUP_WGSL',
  [GOLDEN_ANGLE, sinFromCos],
  `${wgslConsts({ PROBE_THREADS })}
var<workgroup> partial:array<array<vec3f,PROBE_THREADS>,13>;
var<workgroup> partialTravelled:array<vec2f,PROBE_THREADS>;
/** A direction of a Fibonacci spiral, offset on every update to cover the sphere. */
fn rayDirection(slot:u32,jitter:f32,rotation:f32)->vec3f{
 let index=f32(slot)+jitter;
 let z=1.0-2.0*index/f32(PROBE_THREADS);
 let radius=sinFromCos(z);
 let angle=index*GOLDEN_ANGLE+rotation;
 return vec3f(radius*cos(angle),radius*sin(angle),z);
}`,
)
