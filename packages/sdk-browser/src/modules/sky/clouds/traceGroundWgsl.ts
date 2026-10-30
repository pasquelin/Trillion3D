import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { cloudLightWgsl } from './traceLightWgsl.ts'

/**
 * THE GROUND'S BOUNCE ON A SAMPLE, the material's choice (`groundContribution`): the light of the
 * air's lights that the ground, a plain Lambert surface of the component's albedo under the
 * sample, sends back up into the cloud, as if it lit the sample from every direction of the lower
 * hemisphere equally (so the uniform phase), less what the cloud between the sample and the ground
 * takes out of it.
 *
 * The cloud's depth toward the ground is five samples of its extinction along the vertical, at
 * most five kilometres long or the sample's altitude in the layer, spread by their square, as the
 * shadow ray's; a sample where the material's density bound is zero adds nothing. The light is
 * each light's illuminance before the cloud's scale, with the air's transmittance toward it at the
 * sample, times the ground's albedo over pi times the cosine of the first light on the ground,
 * times the hemisphere's solid angle (2 pi) times the uniform phase. With no air the ground's
 * normal is the sample's direction from the eye (\`counts.w\` 0). The program that includes it
 * declares the trace block (\`cloudTrace\`), whose \`ground\` is the albedo.
 */
const GROUND = `
const CLOUD_PI:f32=3.14159265;
/** The vertical length, in centimetres, over which the ground's bounce is dimmed at most, and the
 *  samples that integrate it. */
const CLOUD_GROUND_LENGTH_CM:f32=500000.0;
const CLOUD_GROUND_STEPS:f32=5.0;
/** The light the ground bounces into the sample at \`rel\` centimetres from the eye, \`air\` the air's
 *  transmittance toward each of \`lights\` there. */
fn cloudGroundLight(rel:vec3f,air:array<vec3f,2>,lights:CloudLights)->vec3f{
 let centre=cloudPlanetEye+rel;
 // With no air the view holds no planet: its centre is the eye, and the ground's normal is the
 // sample's direction from the eye, as the engines that fixed this law draw it.
 let normal=normalize(select(rel,centre,cloudTrace.counts.w==1u));
 let reach=min(CLOUD_GROUND_LENGTH_CM,length(centre)-cloudBottomCm);
 let each=1.0/CLOUD_GROUND_STEPS;
 var depth=vec3f(0.0);
 var before=0.0;
 for(var s=each;s<=1.00001;s+=each){
  let after=s*s;
  let share=after-before;
  let at=rel-normal*(reach*(after-0.5*share));
  before=after;
  let probe=cloudProbeAt(at);
  if(!cloudProbeDense(probe)){continue;}
  let there=cloudPointOf(probe,at);
  depth+=there.spot.extinction*(reach*CLOUD_CM_TO_M*share);
 }
 var bounced=vec3f(0.0);
 for(var k=0u;k<lights.count;k++){bounced+=air[k]*lights.list[k].raw;}
 let lambert=saturate(dot(lights.list[0].toward,normal))*(cloudTrace.ground.rgb/CLOUD_PI);
 return bounced*(lambert*(2.0*CLOUD_PI*UNIFORM_PHASE))*exp(-depth);
}`

/** The ground's bounce over the light of the same kind of trace (`cloudLightWgsl`). */
export const cloudGroundWgsl = (fromMap: boolean, debug = false) =>
  wgslBlock('CLOUD_GROUND_WGSL', [cloudLightWgsl(fromMap, debug)], GROUND)
