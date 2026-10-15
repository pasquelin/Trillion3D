/**
 * The shadow of one light at one receiver, through the virtual shadow maps: the one estimator every
 * lit surface reads. The receiver is pushed along its normal by the normal bias, then traced
 * (`traceWgsl.ts`): its rays' screen segment, then their march over the light's map.
 *
 * Two hosts evaluate it, on the same view uniform (`VsmProjectionView`, `projectionView.ts`), the same
 * blue noise and the same maps:
 * - the projection pass (`projectionWgsl.ts`), on the opaque pixels, 64 a workgroup: its 32-pixel
 *   halves vote their rays' count;
 * - the blended surfaces and the water (`../lighting/direct/shadowWgsl.ts`), a fragment each, `lone`:
 *   no lane of another voting beside it, a fragment never stops on a vote, only on its own first
 *   ray hitting a narrow occluder (`rayCountStatement`). It never traces fewer rays than a voting
 *   pixel would: never less image.
 *
 * The host declares `vsmView` and `vsm` (`VsmUniforms`) and gives what the trace reads
 * (`VsmTraceHost`).
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { VSM_TRACE_LIGHT_WGSL, type VsmTraceHost, vsmTraceWgsl } from './traceWgsl.ts'
import { VSM_TRACE_RESULT_WGSL } from './traceCommonWgsl.ts'

/**
 * THE BIASES OF A RECEIVER, the one reading of them — its normal bias length and the normal it
 * follows (`vsmBiasNormal`): the projection's trace (below) and the
 * translucent casters' transmission read (`vsmReceiverFromEye`, `../lighting/direct/vsmConsumerWgsl.ts`)
 * push a receiver by the same length, so the mask and the transmission read one point. Its inverse
 * tangent is the projection's own (`halfFovTangents.z`, 1 under an orthographic view), its distance
 * along the view axis under an orthographic view. The host declares `vsmView` and `vsm`.
 */
export const VSM_NORMAL_OFFSET_WGSL = wgslBlock(
  'VSM_NORMAL_OFFSET_WGSL',
  [VSM_CONSTANTS_WGSL],
  /* wgsl */ `
/** The distance to the camera from a view vector (along the view axis for an orthographic view). */
fn vsmCameraDistance(v:vec3f)->f32{
 var d=length(v);
 if(vsmView.isOrtho!=0u){d*=d/dot(v,vsmView.viewForward);}
 return d;
}
/** The normal bias length of a receiver \`fromEye\` from the eye (0.02 cm floor =
 *  VSM_NORMAL_OFFSET_FLOOR). */
fn vsmNormalOffset(fromEye:vec3f)->f32{
 return vsmNormalOffsetLength(vsm.normalBias,vsmCameraDistance(fromEye),vsmView.halfFovTangents.z);
}
/** The normal a receiver's biases follow (normal bias, receiver-plane depth slope): its triangle's
 *  plane \`plane\` (the engine's shadow receiver, \`shadowReceiver\`) turned to the side the shading
 *  normal \`n\` faces, or \`n\` where it has no plane (zero). The one rule of the projection and of
 *  the lighting. */
fn vsmBiasNormal(n:vec3f,plane:vec3f)->vec3f{
 if(dot(plane,plane)==0.0){return n;}
 return select(plane,-plane,dot(plane,n)<0.0);
}
`,
)

/** The trace of one light at one receiver, every host's (`VsmTraceHost`): the projection's 64
 *  pixels a group, a blended surface's or the water's fragment alone. */
export const vsmReceiverTraceWgsl = (host: VsmTraceHost) =>
  wgslBlock(
    `vsmReceiverTraceWgsl(${host.hiz.join(', ')}, ${host.lone})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_NORMAL_OFFSET_WGSL,
      VSM_TRACE_LIGHT_WGSL,
      VSM_TRACE_RESULT_WGSL,
      vsmTraceWgsl(host),
    ],
    /* wgsl */ `
/** \`biasNormal\`: the normal the receiver's biases follow (normal bias, receiver-plane depth slope);
 *  the shading normal unless the engine's shadow receiver gives its triangle's plane. */
struct VsmSurfaceInfo{valid:bool,subsurface:bool,worldNormal:vec3f,biasNormal:vec3f,}
/** What a receiver brings to its lights: its pixel, whether it is in the view rect and its shading
 *  info; where a light can shade it (\`info.valid\`), its view depth, its shifted point, its screen
 *  ray length and its blue noise — zero elsewhere, where no light reads them (the projection's
 *  \`vsmLightParticipates\`, the traces' \`participating\`). */
struct VsmPixel{pos:vec2u,inRect:bool,info:VsmSurfaceInfo,sceneDepth:f32,shifted:vec3f,screenRayWorld:f32,noise:f32,}
/** Light k's shadow at a receiver (\`vsmView.lights[k]\`): the receiver pushed along its bias normal
 *  by the normal bias (a thin-subsurface one is not), then traced (\`vsmTraceLight\`). */
fn vsmProjectLight(k:u32,pixel:VsmPixel,participating:bool)->VsmTraceResult{
 var P=pixel.shifted;
 if(participating&&!pixel.info.subsurface){P+=pixel.info.biasNormal*vsmNormalOffset(P-vsmView.shiftedEye);}
 return vsmTraceLight(vsmView.lights[k],pixel,P,participating);
}
`,
  )
