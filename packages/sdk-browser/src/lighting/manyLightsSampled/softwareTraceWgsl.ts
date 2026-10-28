/**
 * THE SOFTWARE TRACE OF THE SAMPLES' RAYS: the rays the screen left (the second compacted list), marched through the global distance field
 * (`gdfTrace`, the engine's one, over the reads of `globalReadWgsl.ts`) from where the screen left them (the ray word's distance) to the light less a centimetre,
 * the field's surface expanded by half a voxel at each end and the march dithered by the sample's own place. A ray that meets the field shadows its sample
 * (`visible` false); the others are left as the screen found them. One thread a ray of the list. Lengths in the field's unit, the centimetre.
 * The reference traces this stage with the same bias and expansion (a half voxel each end) and no distant screen trace after it: that follows only its
 * hardware trace, past the range of the scene's acceleration structure.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { globalDistanceFieldTraceWgsl } from '../distanceField/globalTraceWgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import {
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
  REFLECTION_GROUP,
} from '../reflections/viewLayout.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { COMPACT_THREADS, TRACE_TEXEL_WGSL } from './compactWgsl.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import { lightSampleIndex, lightSampleRayDistance, lightSampleRayUv } from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { JITTER_WGSL } from './samplingWgsl.ts'
import { SAMPLE_IO_WGSL } from './screenTraceWgsl.ts'

const B = SAMPLED_BINDINGS

/** The first binding of the global field's reads in the kernel's group 0 (six bindings). */
export const SOFTWARE_FIELD_BINDING = 140

export const SOFTWARE_TRACE_ENTRY = 'softwareTraceMain'

export const softwareTraceWgsl = () =>
  wgslProgram(
    `
const FIELD_CM:f32=${DISTANCE_FIELD_UNITS_PER_METRE}.0;
@group(0) @binding(${B.compactData}) var<storage,read> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
@compute @workgroup_size(${COMPACT_THREADS},1,1)
fn ${SOFTWARE_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=compactCount[1]){return;}
 let texel=unpackTraceTexel(compactData[params.sampleView.x*params.sampleView.y+id.x]);
 let c=vec2i(texel);
 let ray=textureLoad(rays,c).r;
 let index=lightSampleIndex(textureLoad(samples,c).r);
 let down=texel/params.samples;
 let screen=min(down*params.factor+downsampleJitter(down),vec2u(view.viewport.xy)-vec2u(1u));
 let P=worldAt(vec2f(screen)+vec2f(0.5),hizOpaqueDepth(vec2i(screen)));
 let segment=lightSampleTrace(index,P,lightSampleRayUv(ray));
 let begin=lightSampleRayDistance(ray)*FIELD_CM;
 let end=max(begin,(segment.w-0.01)*FIELD_CM);
 var input=gdfTraceInput(gdfTranslated(P*FIELD_CM),segment.xyz,begin,end,1.0,1.0);
 input.rayBias=0.5;
 input.rayEndBias=0.5;
 input.dithered=true;
 input.ditherCoord=vec2f(texel);
 input.turn=f32(params.frame&7u);
 if(gdfTrace(input).hitTime>=0.0){hideSample(c);}
}`,
    [
      SAMPLED_PARAMS_WGSL,
      JITTER_WGSL,
      SAMPLE_IO_WGSL,
      TRACE_TEXEL_WGSL,
      LIGHT_TRACE_WGSL,
      LIGHTS_BINDING_WGSL,
      WORLD_AT_WGSL,
      reflectionBindingsWgsl(REFLECTION_GROUP),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      globalDistanceFieldTraceWgsl(0, SOFTWARE_FIELD_BINDING),
      lightSampleIndex,
      lightSampleRayDistance,
      lightSampleRayUv,
    ],
  )
