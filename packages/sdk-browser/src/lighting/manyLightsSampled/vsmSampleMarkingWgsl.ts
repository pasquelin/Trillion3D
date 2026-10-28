/**
 * THE SHADOW MAPS' PAGE MARKING FROM THE SAMPLES (setting `sampledLightsVsmMarkPages`): where a sample's light is shadowed by the virtual shadow maps, the page of
 * that light's map the sample's surface falls in is marked, and no other: the lights the sample draw left out mark nothing. One thread a sample of the samples'
 * texture. It marks as the pixel pass does (`vsmPixelPageMarkingWgsl`): the same page functions, imported (`vsmPageMarkingBlock`), the local light's map by its
 * cube face and mip level, a sun's by every clipmap of the view. With the setting off, the pixel pass marks every page its cell's lights might need.
 * Group 0 is the shadow maps' tables (`VSM_PIXELS_SPECS`); group 1 holds the depth, the view, the lights, the lights' map ids, the marking's
 * parameters, the sampled lighting's uniform and the samples.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { VSM_HANDLE_WGSL } from '../shadows/vsm/pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmViewDepthOfDeviceZ,
} from '../shadows/vsm/projection/projectionDataWgsl.ts'
import {
  NO_MIN_LEVEL,
  VSM_MARKING_PARAMS_WGSL,
  VSM_PIXELS_SPECS,
  vsmPageMarkingBlock,
} from '../shadows/vsm/markingWgsl.ts'
import { vsmBindingsWgsl } from '../shadows/vsm/resources.ts'
import type { VsmLayout } from '../shadows/vsm/layout.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { lightSampleIndex, lightSampleWeight, NO_LIGHT_INDEX } from './lightSamplerWgsl.ts'
import { sampledParamsWgsl } from './paramsWgsl.ts'
import { jitterWgsl } from './samplingWgsl.ts'

/** Group 1 of the marking, by name. */
export const VSM_SAMPLE_MARKING_BINDING = {
  depth: 0,
  view: 3,
  directLights: 4,
  lightIds: 6,
  sunIds: 7,
  marking: 8,
  samples: SAMPLED_BINDINGS.samples,
} as const

export const VSM_SAMPLE_MARKING_ENTRY = 'vsmMarkSamples'

const G = VSM_SAMPLE_MARKING_BINDING
const PARAMS_GROUP_1 = sampledParamsWgsl(1)

export const vsmSampleMarkingWgsl = (layout: VsmLayout, throttled = false) =>
  wgslProgram(
    `
@group(1) @binding(${G.depth}) var depth:texture_depth_2d;
@group(1) @binding(${G.view}) var<uniform> view:View;
@group(1) @binding(${G.directLights}) var<storage,read> directLights:DirectLights;
@group(1) @binding(${G.lightIds}) var<storage,read> vsmLightIds:array<i32>;
@group(1) @binding(${G.sunIds}) var<storage,read> vsmDirectionalLightIds:array<u32>;
@group(1) @binding(${G.marking}) var<uniform> vsmMarking:VsmMarkingParams;
@group(1) @binding(${G.samples}) var samples:texture_2d<u32>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${VSM_SAMPLE_MARKING_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 if(any(id.xy>=params.sampleView)){return;}
 let word=textureLoad(samples,vec2i(id.xy),0).r;
 let index=lightSampleIndex(word);
 if(index==${NO_LIGHT_INDEX}u||lightSampleWeight(word)<=0.0){return;}
 let down=id.xy/params.samples;
 let screen=min(down*params.factor+downsampleJitter(down),vec2u(view.viewport.xy)-vec2u(1u));
 let deviceZ=textureLoad(depth,vec2i(screen),0);
 let sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmMarking.depthFromDeviceZ);
 let world=worldAt(vec2f(screen)+0.5,deviceZ);
 let shifted=(world+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
 let marginSide=vec2f(select(-1.0,1.0,(groupIndex&1u)!=0u),select(-1.0,1.0,(groupIndex&2u)!=0u));
 let extraBias=vsmDofResolutionBias(sceneDepth);
 let light=directLights.items[index];
 if(isSun(light)){
  let hasMargin=vsmMarking.pageDilation.x>0.0;
  let marginOffset=vsmMarking.pageDilation.x*marginSide;
  for(var m=0u;m<vsmMarking.sunMapCount;m++){
   vsmMarkPageDirectional(vsmHandleFromId(vsmDirectionalLightIds[m]),shifted,hasMargin,marginOffset,extraBias,${NO_MIN_LEVEL});
  }
  return;
 }
 let handle=vsmHandleFromId(bitcast<u32>(vsmLightIds[index]));
 if(!vsmHandleIsValid(handle)){return;}
 let lightPosition=(light.positionRange.xyz+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
 let hasMargin=vsmMarking.pageDilation.y>0.0;
 vsmMarkPageLocal(lightPosition,!isSpot(light),handle,shifted,sceneDepth,hasMargin,vsmMarking.pageDilation.y*marginSide,extraBias);
}`,
    [
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_MARKING_PARAMS_WGSL,
      VIEW_WGSL,
      vsmBindingsWgsl(0, VSM_PIXELS_SPECS, layout),
      DIRECT_LIGHT_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      vsmViewDepthOfDeviceZ,
      vsmPageMarkingBlock(throttled, layout.prefilteredDistant),
      WORLD_AT_WGSL,
      PARAMS_GROUP_1,
      jitterWgsl(PARAMS_GROUP_1),
      lightSampleIndex,
      lightSampleWeight,
    ],
  )
