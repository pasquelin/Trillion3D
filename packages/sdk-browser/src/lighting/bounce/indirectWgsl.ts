import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts'

/**
 * THE INDIRECT LIGHT AT A POINT, by who asks. The cascades hold light for a share of a point
 * (`sampleBounceGathered`, its share in `w`); what the reader does with the share they leave — no
 * probe updated there yet, a point no level reaches — is what tells the two readers apart.
 *
 * A PIXEL's shading (`indirectIrradiance`, from `indirectGathered`) falls back on the sky: the share the
 * cascades leave is the unoccluded light the scene's sky light gives (`skyIrradiance`), never zero
 * where a sky light shines, so the image shows no hole while the probes fill. A scene with no sky light
 * has nothing unoccluded to give there — its environment (ambient, hemisphere) is the pixel's own
 * term, added beside the probes whether they answer or not, and counted again here it would shine
 * twice —: the probes that answer stand for the share they do not, as they did before the sky light
 * stood in, and the scene is no darker for a partial read.
 *
 * A RAY'S HIT (`indirectHeld`) — the surface a probe's ray landed on, the one a reflection did — reads
 * only what the cascades hold there: the probes' light for the share they answer, nothing for the
 * rest. The sky reaches the probes through their own rays, occluded by the scene
 * (`skyProbeRadiance`); the unoccluded sky added to a hit would count it a second time for a surface
 * the sky does not reach, and light every street of a canyon from above. A surface whose probes hold
 * nothing yet gives what it holds, which is nothing, and fills as they do, update after update.
 * Those probes are asked for: the cells round a hit are marked (`markPoint`), so the surfaces the
 * probes see get probes of their own.
 */
export const INDIRECT_WGSL = wgslBlock(
  'INDIRECT_WGSL',
  [BOUNCE_GRID_WGSL, SKY_READ_WGSL],
  `
/** The irradiance of a gather of the probes (\`gathered\`, its share of the answer in \`w\`) on a
 *  surface of normal \`N\`: the probes' where they answer, the sky light's for the rest where one
 *  shines, else the probes' mean for the whole. */
fn indirectGathered(gathered:vec4f,N:vec3f)->vec3f{
 if(gathered.w>=1.0||!skyLit()){return gathered.xyz;}
 return mix(skyIrradiance(N),gathered.xyz,gathered.w);
}
fn indirectIrradiance(P:vec3f,N:vec3f)->vec3f{return indirectGathered(sampleBounceGathered(P,N),N);}`,
)

/** The irradiance a ray's hit reads at `P` of normal `N`: what the cascades hold there, their mean
 *  over the share they answer times that share — zero where they answer none. */
export const INDIRECT_HELD_WGSL = wgslBlock(
  'INDIRECT_HELD_WGSL',
  [BOUNCE_GRID_WGSL],
  `
fn indirectHeld(P:vec3f,N:vec3f)->vec3f{
 let gathered=sampleBounceGathered(P,N);
 return gathered.xyz*gathered.w;
}`,
)
