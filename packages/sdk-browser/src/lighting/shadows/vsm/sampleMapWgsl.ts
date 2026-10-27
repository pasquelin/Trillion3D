/**
 * THE ONE-SAMPLE READ OF A LOCAL MAP BY ITS ID: the shadow of a local light the frame's mask holds no
 * lane for (`vsmSampleMapLocal`). The map is told by its id alone: a spot's map, or the cube face
 * of a point or rectangle light that the receiver, in the map's own frame (the light at its origin),
 * lies in — the light's record is not needed. The tap is the trace's own (`vsmLocalTap`,
 * `trace/traceTapWgsl.ts`, the reference's one `SampleVirtualShadowMapLocal`): the compare lifts the
 * receiver along the ray towards the light by `rayStart`, in the map's depth, at the finest mip of the
 * map and with no plane bias, as the reference reads a light with no lane.
 */
import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { VSM_UNIT_PER_CM } from './constants.ts'
import { vsmLocalTapWgsl } from './trace/traceTapWgsl.ts'
import { vsmTraceLightWgsl, VSM_TRACE_KINDS_BOTH } from './trace/traceWgsl.ts'

/** The distance a lookup of a local light that has no lane in the mask is lifted by, in centimetres:
 *  the reference's fixed start of that lookup. */
const VSM_MASK_FALLBACK_START_CM = 200

/** `vsmSampleMapLocal`, sampling the pages of `pool`. The host declares the view `vsmView`. */
export const vsmSampleMapLocalWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmSampleMapLocalWgsl',
    [vsmTraceLightWgsl(VSM_TRACE_KINDS_BOTH), vsmLocalTapWgsl(pool)],
    `
const VSM_MASK_FALLBACK_START:f32=${VSM_MASK_FALLBACK_START_CM}.0*${VSM_UNIT_PER_CM};
/** Local map \`id\`'s share at the receiver \`shifted\` (the view's shifted frame): 0 where the stored depth
 *  of the texel it falls on, lifted by \`rayStart\` towards the light, lies nearer the light than the
 *  receiver, 1 elsewhere and where no page maps it. */
fn vsmSampleMapLocal(id:u32,shifted:vec3f,rayStart:f32)->f32{
 var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 if(pd.lightKind!=LIGHT_KIND_SPOT){
  let inMap=shifted+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
  h=vsmHandleOffset(h,i32(vsmCubeFace(inMap)));
 }
 var m:VsmLightMap;
 vsmLightMapOn(&m,h,shifted);
 return vsmLocalTap(m,rayStart,vec3f(0.0),false,-1.0).shadowFactor;
}`,
  )
