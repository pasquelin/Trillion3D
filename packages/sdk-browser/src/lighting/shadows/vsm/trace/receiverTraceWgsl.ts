/**
 * The shadow of one light at one receiver, through the virtual shadow maps: the one estimator every
 * lit surface reads. The receiver is pushed along its normal by the normal bias, then traced
 * (`traceWgsl.ts`): its rays' screen segment, then their march over the light's map.
 *
 * Two hosts evaluate it, on the same view uniform (`VsmProjectionView`, `../projection/projectionView.ts`), the same
 * blue noise and the same maps:
 * - the projection pass (`../projection/projectionWgsl.ts`), on the opaque pixels, 64 a workgroup: its 32-pixel
 *   halves vote their rays' count;
 * - the translucent surfaces at quality 1 (`LIGHT_SETTINGS.translucentShadowQuality` 1; its default 0
 *   reads one sample, `../sampleLightWgsl.ts`), a fragment each (`../../../direct/shadowWgsl.ts`),
 *   `lone`: no lane of another voting beside it (`rayCountStatement`). A sun's trace takes every ray:
 *   a fragment's lanes share no workgroup to vote in; a local light's votes over its subgroup, or on
 *   the lane's own value without subgroups.
 *
 * The host declares `vsmView` and `vsm` (`VsmUniforms`) and gives what the trace reads
 * (`VsmTraceHost`).
 */
import { wgslBlock, wgslFn } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmTraceHost, vsmTraceLightWgsl, vsmTraceWgsl } from './traceWgsl.ts'
import { VSM_TRACE_RESULT_WGSL } from './traceCommonWgsl.ts'

/** The normal a receiver's biases follow (normal bias, receiver-plane depth slope): its triangle's
 *  plane \`plane\` (the engine's shadow receiver, \`shadowReceiver\`) turned to the side the shading
 *  normal \`n\` faces, or \`n\` where it has no plane (zero). The one rule of the projection and of
 *  the lighting. */
export const VSM_BIAS_NORMAL_WGSL = wgslFn(
  'vsmBiasNormal',
  [],
  `fn vsmBiasNormal(n:vec3f,plane:vec3f)->vec3f{
 if(dot(plane,plane)==0.0){return n;}
 return select(plane,-plane,dot(plane,n)<0.0);
}`,
)

/**
 * THE BIASES OF A RECEIVER, the one reading of them — its normal bias length and the normal it
 * follows (`vsmBiasNormal`): the projection's trace and a blend fragment's push a receiver by the
 * same length. Its inverse
 * tangent is the projection's own (`halfFovTangents.z`, 1 under an orthographic view), its distance
 * along the view axis under an orthographic view. The host declares `vsmView` and `vsm`.
 */
export const VSM_NORMAL_OFFSET_WGSL = wgslBlock(
  'VSM_NORMAL_OFFSET_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_BIAS_NORMAL_WGSL],
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
`,
)

/** The trace of one light at one receiver, every host's (`VsmTraceHost`): the projection's 64
 *  pixels a group, a translucent surface's fragment alone. */
export const vsmReceiverTraceWgsl = (host: VsmTraceHost) =>
  wgslBlock(
    `vsmReceiverTraceWgsl(${host.hiz.join(', ')}, ${host.lone}, ${!!host.subgroups}, ${host.transmission?.name ?? null}, ${host.kinds})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_NORMAL_OFFSET_WGSL,
      vsmTraceLightWgsl(host.kinds),
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
/** What a receiver brings to every light, read once (\`vsmReceiverOf\`): its point \`P\`, pushed
 *  along its bias normal by the normal bias (a thin-subsurface one is not), and, where it has a
 *  screen segment, what that segment reads there (\`vsmScreenRayStart\`). Set where
 *  \`participating\`. */
struct VsmReceiver{P:vec3f,screen:VsmScreenStart,}
fn vsmReceiverOf(pixel:VsmPixel,participating:bool)->VsmReceiver{
 var r:VsmReceiver;
 r.P=pixel.shifted;
 if(participating&&!pixel.info.subsurface){
  r.P+=pixel.info.biasNormal*vsmNormalOffset(r.P-vsmView.shiftedEye);
  if(pixel.screenRayWorld>0.0){r.screen=vsmScreenRayStart(r.P);}
 }
 return r;
}
/** Light k's shadow at a receiver (\`vsmView.lights[k]\`), a fragment's: its receiver
 *  (\`vsmReceiverOf\`), traced (\`vsmTraceLight\`). */
fn vsmProjectLight(k:u32,pixel:VsmPixel,participating:bool)->VsmTraceResult{
 return vsmTraceLight(vsmView.lights[k],pixel,vsmReceiverOf(pixel,participating),participating);
}
`,
  )
