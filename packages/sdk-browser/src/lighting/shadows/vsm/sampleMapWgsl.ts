/**
 * THE ONE-SAMPLE READ OF A LOCAL MAP BY ITS ID: the shadow of a local light the frame's mask holds no
 * lane for (`vsmSampleMapLocal`). The map is told by its id alone: a spot's map, or the cube face
 * of a point or rectangle light that the receiver, in the map's own frame (the light at its origin),
 * lies in — the light's record is not needed. The compare lifts the receiver along the ray towards
 * the light by `rayStart` (the reference's ray start), in the map's depth: a perspective map's depth
 * per unit of distance is its projection's third diagonal term over the clip w.
 */
import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../math/src/wgsl/projection.ts'
import { VSM_UNIT_PER_CM } from './constants.ts'
import { vsmTraceMapWgsl } from './trace/traceMapWgsl.ts'
import { vsmTraceLightWgsl, VSM_TRACE_KINDS_BOTH } from './trace/traceWgsl.ts'

/** The distance a lookup of a local light that has no lane in the mask is lifted by, in centimetres:
 *  the reference's fixed start of that lookup. */
const VSM_MASK_FALLBACK_START_CM = 200

/** `vsmSampleMapLocal`, sampling the pages of `pool`. The host declares the view `vsmView`. */
export const vsmSampleMapLocalWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmSampleMapLocalWgsl',
    [vsmTraceLightWgsl(VSM_TRACE_KINDS_BOTH), vsmTraceMapWgsl(pool), perspectiveDivide],
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
  pd=vsmProjectionOf(h);
 }
 var m:VsmLightMap;
 vsmLightMapOn(&m,h,shifted);
 let uvz=perspectiveDivide(m.mapPoint);
 let read=vsmReadMap(h,uvz.xy,h.finestMip);
 if(!read.valid){return 1.0;}
 let start=-max(rayStart,0.0)*pd.lightViewToClip[2][2]/m.mapPoint.w;
 return select(1.0,0.0,read.depth-start>uvz.z);
}`,
  )
