import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { sinFromCos } from '../../../../../math/src/wgsl/geometry.ts'
import { GOLDEN_ANGLE } from '../../../../../math/src/wgsl/constants.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../../gpu/core/textureLimits.ts'
import { CENSUS_WORDS } from './censusWgsl.ts'
import { FILTER_BYTES } from './probeFilterWgsl.ts'

/** The partial sums a thread of the update holds: nine basis accumulators, four of distance and two of the
 *  shares the probe's neighbours get from its ray (`probeFilterWgsl.ts`). */
const PROBE_SUMS = 15
/** Bytes of workgroup memory a thread of the update holds: its `PROBE_SUMS` `vec3f` sums, 16 bytes
 *  each in an array, and one `f32` of travel. */
const BYTES_PER_THREAD = PROBE_SUMS * 16 + 4

/**
 * THE PROBE UPDATE'S GROUP (`probeWgsl.ts`): one probe a workgroup, one thread a ray — its width
 * is the probe's rays (`raysPerProbe`), never the dispatch width other kernels tune —, each
 * thread's sums gathered by halves in workgroup memory. So the width is a power of two, and its
 * sums — with the neighbours' the filter reads (`FILTER_BYTES`) and the census's tally (four bytes a
 * counter, `censusWgsl.ts`) — fit the memory every device holds; a setting past either is refused here, at load.
 */
export const PROBE_THREADS = BOUNCE_SETTINGS.raysPerProbe
if (
  PROBE_THREADS & (PROBE_THREADS - 1) ||
  PROBE_THREADS * BYTES_PER_THREAD + FILTER_BYTES + CENSUS_WORDS * 4 > GUARANTEED_WORKGROUP_BYTES
)
  throw new RangeError(
    `raysPerProbe ${PROBE_THREADS}: a power of two whose sums fit ${GUARANTEED_WORKGROUP_BYTES} bytes`,
  )

/** The group's width — the probe's rays, one a thread —, its partial sums — nine basis accumulators, four of
 *  distance, two of neighbour shares, and the travel — and the direction of a ray. */
export const PROBE_GROUP_WGSL = wgslBlock(
  'PROBE_GROUP_WGSL',
  [GOLDEN_ANGLE, sinFromCos],
  `${wgslConsts({ PROBE_THREADS, PROBE_SUMS })}
var<workgroup> partial:array<array<vec3f,PROBE_THREADS>,PROBE_SUMS>;
var<workgroup> partialTravelled:array<f32,PROBE_THREADS>;
/** A direction of a Fibonacci spiral, offset on every update to cover the sphere. */
fn rayDirection(slot:u32,jitter:f32,rotation:f32)->vec3f{
 let index=f32(slot)+jitter;
 let z=1.0-2.0*index/f32(PROBE_THREADS);
 let radius=sinFromCos(z);
 let angle=index*GOLDEN_ANGLE+rotation;
 return vec3f(radius*cos(angle),radius*sin(angle),z);
}`,
)
