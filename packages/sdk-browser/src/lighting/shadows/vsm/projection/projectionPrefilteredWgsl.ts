/**
 * THE SUNS' PROJECTION OF THE PREFILTERED DISTANT SHADOW (`projectionEntryWgsl.ts` runs it before
 * the trace of a sun whose clipmap holds one): the merged pool's value at the receiver's point, the
 * level below the one its distance asks, read by a bilinear sample (`filterableWgsl.ts` makes the
 * pool). A receiver it shadows whole (a factor of a ten-thousandth at most) is traced no further; any
 * other takes the trace's share multiplied by it. Reads the merged pool the module binds
 * (`vsmFilterableMerged` and its `vsmFilterableMergedLoad`), the view `vsmView` and the light's
 * struct (`vsmTraceLightWgsl`) the host brings.
 */
import { wgslBlock, type WgslDecl } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { vsmFilterableBytesWgsl } from '../filterableBytesWgsl.ts'
import { VSM_PREFILTERED_WGSL } from '../prefilteredWgsl.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from '../pageTableWgsl.ts'
import { VSM_TRACE_RESULT_WGSL } from '../trace/traceCommonWgsl.ts'
import { VSM_ORTHO_OCCLUDER_WGSL } from '../trace/traceRayWgsl.ts'
import { vsmProjectionSampleWgsl } from './projectionSampleWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'

/** A factor at most this is a receiver shadowed whole, no more traced. */
const SHADOWED_WHOLE = 0.0001

/** The sample and its combination with a trace, reading the pages of `pool` (`vsmPoolLoad`). */
export const vsmProjectionPrefilteredWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmProjectionPrefilteredWgsl',
    [
      VSM_CONSTANTS_WGSL,
      VSM_PREFILTERED_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_TRACE_RESULT_WGSL,
      VSM_ORTHO_OCCLUDER_WGSL,
      vsmFilterableBytesWgsl('vsmFilterableMerged', { bilinear: true }),
      vsmProjectionSampleWgsl(pool),
    ],
    /* wgsl */ `
/** The filtered shade at a receiver: \`valid\` where the sun's clipmap holds one and has the level; the
 *  factor, 0 where the page is no secondary request; the occluder distance of the level's depth range. */
struct VsmPrefilteredSample{valid:bool,factor:f32,occluderDistance:f32,}
/** The sample of the sun \`light\` at the receiver point \`P\` (the normal-biased point), for a lane that
 *  \`participating\`: the clipmap level one coarser than the receiver's distance asks, the merged pool read
 *  at the point's texel. */
fn vsmPrefilteredSample(light:VsmProjectionLight,P:vec3f,participating:bool)->VsmPrefilteredSample{
 var r:VsmPrefilteredSample;
 if(!participating){return r;}
 let h=vsmHandleFromId(u32(light.mapId));
 let base=vsmProjectionOf(h);
 if(!vsmMapPrefiltered(base)){return r;}
 let d2=vsmDistanceSqToOrigin(base,P,vsmView.originShiftHigh,vsmView.originShiftLow);
 let index=max(0,i32(floor(vsmSampledLevel(base,d2,-1.0)))-base.mapLevel)+1;
 if(index>=base.levelsLeft){return r;}
 let levelMap=vsmHandleOffset(h,index);
 let pd=vsmProjectionOf(levelMap);
 let inMap=P+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
 let at=vsmLevelTexelAt((pd.shiftedToMapUv*vec4f(inMap,1.0)).xy*f32(VSM_LEVEL0_TEXELS));
 if(!vsmPageInRange(at.vPage,0u)){return r;}
 r.valid=true;
 let entry=vsmTableWord(vsmTableEntryOf(levelMap,0u,vec2u(at.vPage)));
 if(vsmEntrySecondary(entry)){
  r.factor=vsmFilterableMergedBilinear(vsmPoolIndexOf(vsmUnpackTableEntry(entry).physicalAddress),at.inPage);
  if(r.factor<0.00000001){r.factor=0.0;}
 }
 // The distance between the level's two depths: its depth range's far end to its near end.
 r.occluderDistance=vsmOrthoOccluderDistance(pd.lightViewToClip,pd.dynamicDepthCullRange.y,pd.dynamicDepthCullRange.x);
 return r;
}
/** Whether the sample shadows the receiver whole. */
fn vsmPrefilteredWhole(s:VsmPrefilteredSample)->bool{return s.valid&&s.factor<=${SHADOWED_WHOLE};}
/** The trace \`traced\` under the sample \`s\`: the trace alone where there is no sample; else the product
 *  of the two shares. Their occluder distance is the sample's while the trace shadows nothing, else the
 *  sample's mixed toward the trace's by the sample's share: the lighter the sample, the nearer the
 *  trace's. */
fn vsmPrefilteredCombine(s:VsmPrefilteredSample,traced:VsmTraceResult)->VsmTraceResult{
 if(!s.valid){return traced;}
 var r=traced;
 r.rayCount=max(traced.rayCount,1u);
 r.shadowFactor=s.factor*traced.shadowFactor;
 r.occluderDistance=select(s.occluderDistance,mix(s.occluderDistance,traced.occluderDistance,s.factor),traced.shadowFactor<1.0);
 return r;
}
`,
  )
