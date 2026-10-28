/**
 * THE VIRTUAL SHADOW MAPS' TRACE OF THE SAMPLES (setting `sampledLightsShadowMethod` 'virtualShadowMap'): for each sample whose light the maps shadow (a shadow slot
 * of its own, `shadowSliceRecord`), ONE ray traced through the light's map (the receiver trace the translucent surfaces read, `vsmFragmentTraceWgsl`, with `rays` 1 for the
 * local lights: the suns keep the view's count), from the sample's surface pushed along its normal, over the depth pyramid's screen segment. A share of the ray under a
 * half shadows the sample (`visible` false). The sample is complete either way: no later trace takes it. One thread a ray of the third compacted list
 * (`compactWgsl.ts`, `MODE` 2), before the compaction of the screen's trace.
 * The ray is the trace's own (its disk and dither drawn from the blue noise), not the sample's place on the light.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { COLOURS_BINDING_WGSL } from '../deferred/litSurfaceWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { THIN_SURFACE_WGSL } from '../direct/lightingWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { vsmConsumerWgsl } from '../direct/vsmConsumerWgsl.ts'
import { SHADOW_SLICE_WGSL } from '../direct/shadowSlice.ts'
import { vsmFragmentTraceWgsl } from '../direct/shadowTraceWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../reflections/constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../reflections/viewLayout.ts'
import { SURFACE_COLOUR_LAYERS } from '../../materials/surface/surfaceOutputs.ts'
import { VSM_TRACE_KINDS_BOTH } from '../shadows/vsm/trace/traceWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { COMPACT_THREADS, TRACE_TEXEL_WGSL } from './compactWgsl.ts'
import { lightSampleIndex } from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { JITTER_WGSL } from './samplingWgsl.ts'
import { SAMPLE_IO_WGSL } from './screenTraceWgsl.ts'

const D = DEFERRED_BINDINGS

/** Where the kernel binds the maps' data (the lit passes' own numbers) and the blue noise. */
export const VSM_TRACE_BINDING = {
  pageTable: D.vsmPageTable,
  projectionData: D.vsmProjectionData,
  uniforms: D.vsmUniforms,
  pool: D.vsmPool,
  view: D.vsmView,
  noise: SAMPLED_BINDINGS.blue,
} as const

export const VSM_TRACE_ENTRY = 'vsmTraceSamplesMain'

/** The rays a local light's trace casts here. */
const VSM_SAMPLE_RAYS = 1

/** `classic`: the shadows are classic shadow maps (`shadowVirtualEnable` off), read by the classic filter as the translucent surfaces read them. */
export const vsmTraceSamplesWgsl = (classic = false) =>
  wgslProgram(
    `
@group(0) @binding(${SAMPLED_BINDINGS.compactData}) var<storage,read> compactData:array<u32>;
@group(0) @binding(${SAMPLED_BINDINGS.compactCount}) var<storage,read> compactCount:array<u32>;
@compute @workgroup_size(${COMPACT_THREADS},1,1)
fn ${VSM_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=compactCount[2]){return;}
 let texel=unpackTraceTexel(compactData[2u*params.sampleView.x*params.sampleView.y+id.x]);
 let c=vec2i(texel);
 let index=lightSampleIndex(textureLoad(samples,c).r);
 let slice=i32(directLights.items[index].params.y);
 let down=texel/params.samples;
 let screen=min(down*params.factor+downsampleJitter(down),vec2u(view.viewport.xy)-vec2u(1u));
 let P=worldAt(vec2f(screen)+vec2f(0.5),hizOpaqueDepth(vec2i(screen)));
 let N=normalize(textureLoad(colours,vec2i(screen),${SURFACE_COLOUR_LAYERS.normal},0).xyz);
 vsmTraceAt(vec2f(screen)+vec2f(0.5));
 completeSample(c,vsmTraceFactor(shadowSliceRecord(slice),P,N)<0.5);
}`,
    [
      SAMPLED_PARAMS_WGSL,
      JITTER_WGSL,
      TRACE_TEXEL_WGSL,
      SAMPLE_IO_WGSL,
      DIRECT_LIGHT_WGSL,
      LIGHTS_BINDING_WGSL,
      COLOURS_BINDING_WGSL,
      WORLD_AT_WGSL,
      SHADOW_SLICE_WGSL,
      THIN_SURFACE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      reflectionBindingsWgsl(REFLECTION_GROUP),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      vsmConsumerWgsl(VSM_TRACE_BINDING),
      vsmFragmentTraceWgsl(
        VSM_TRACE_BINDING.pool,
        { view: VSM_TRACE_BINDING.view, noise: VSM_TRACE_BINDING.noise },
        VSM_TRACE_KINDS_BOTH,
        VSM_SAMPLE_RAYS,
        classic,
      ),
      lightSampleIndex,
    ],
  )
