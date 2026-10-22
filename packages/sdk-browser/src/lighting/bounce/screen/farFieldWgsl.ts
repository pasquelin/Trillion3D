import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { REFLECTION_FIELD_OVER_WGSL } from '../../reflections/wgsl.ts'
import { probeFieldWgsl } from '../gridWgsl.ts'

/** The values of the probes' slots the far field blends: the nine harmonics' coefficients (slots 0 to 8) and the two
 *  vectors of the probe's axis distances (9 and 10). */
const FAR_VALUES = 11

/** The gather of the cascades' probes round a probe's point, two of the slots' values at once (`pair`: slots `2·pair` and
 *  the next, the last pair's second one the last slot again): one gather, the same weights for every value. */
const FAR_FIELD = probeFieldWgsl('screenFar', 'screenFarLevel', ',pair:u32', [
  'probeAt(probe,pair*2u).xyz',
  `probeAt(probe,min(pair*2u+1u,${FAR_VALUES - 1}u)).xyz`,
])

/**
 * THE FAR FIELD OF A PROBE, gathered once for the probe: the radiance the cascades' probes round the probe's point give
 * along a direction is, for every direction, the same weights on the same probes — only the harmonics' factors differ. So
 * the workgroup of a probe blends the probes' coefficients and axis distances once (`spFarGather`: six lanes, a pair of
 * slots each, one gather of the eight probes of each level; the caller's barrier follows), and every ray reads the blend:
 * `spFarRadiance`, the harmonics of its direction over the blended coefficients (never negative) added over the
 * surroundings (`reflectionFieldOver`, the one rule the reflections' last stage answers by), and `spFarDistance`, the
 * blended axis distances along it where the probes answered, the scene's limit where they did not. Eight probes a level
 * are read for the whole probe, where a gather a ray read them for each.
 */
export const spFar = wgslBlock(
  'spFar',
  [FAR_FIELD, REFLECTION_FIELD_OVER_WGSL],
  `var<workgroup> farValues:array<vec3f,${FAR_VALUES}>;
var<workgroup> farHeld:f32;
fn spFarGather(P:vec3f,N:vec3f,lane:u32){
 if(lane<6u){
  let g=screenFarGathered(P,N,lane);
  farValues[2u*lane]=g[0].xyz;
  if(2u*lane+1u<${FAR_VALUES}u){farValues[2u*lane+1u]=g[1].xyz;}
  if(lane==0u){farHeld=g[0].w;}
 }
}
fn spFarRadiance(d:vec3f)->vec3f{
 let basis=spBasis(d);
 var sum=vec3f(0.0);
 for(var k=0u;k<9u;k++){sum+=farValues[k]*basis[k];}
 return reflectionFieldOver(vec4f(max(sum,vec3f(0.0)),farHeld),d);
}
fn spFarDistance(d:vec3f)->f32{
 return select(SP_MAX_TRACE,min(distanceAlong(farValues[9],farValues[10],d),SP_MAX_TRACE),farHeld>0.0);
}`,
)
