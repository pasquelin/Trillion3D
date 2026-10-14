import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import { VSM_UNIFORMS_WGSL } from '../../vsm/uniforms.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from '../../vsm/pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmProjectionSampleWgsl,
} from '../../vsm/projectionDataWgsl.ts'
import { vsmTransmissionReadWgsl } from '../../vsm/transmissionReadWgsl.ts'
import { VSM_NORMAL_OFFSET_WGSL } from '../../vsm/receiverTraceWgsl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { byShadowKind, shadowKindsLabel, type ShadowKinds } from './shadowKinds.ts'
import { forwardPool, vsmBindingsLabel, type VsmConsumerBindings } from './shadowBindings.ts'

/** The opaque resolve binds no pool: its opaque shadow is the mask's, and its transmission read
 *  takes a sample's page, never its depth (`vsmTransmissionRead`), so a depth reads 0 there, which
 *  no read takes. Its stage holds the eight storage buffers WebGPU guarantees
 *  (`deferredLayoutEntries`). */
const RESOLVE_POOL = wgslFn('vsmPoolLoad', [], 'fn vsmPoolLoad(t:vec2u,slice:u32)->u32{return 0u;}')

/**
 * Where a point is read in a virtual shadow map (`vsmLocate`) — directional or local, one page-table
 * lookup with a coarser-level fallback — for VSM id `id`: what the translucent casters'
 * transmission read starts from (`vsmTransmissionRead`), at a point `P` of unit normal `N` moved
 * along it by the normal bias length (`vsmReceiverFromEye`). The origin shift is the pass's eye
 * (`shadowCamera`), in single precision. The host declares the projection's view `vsmView`
 * (`vsmTraceViewWgsl`). `pool`: the pass reads the pool (`forwardPool`),
 * which the traces sample (`vsmTraceWgsl`); the opaque resolve does not.
 */
export const vsmConsumerWgsl = (
  b: VsmConsumerBindings,
  { transmission, pool, kinds }: { transmission: number; pool: boolean; kinds: ShadowKinds },
) =>
  wgslBlock(
    `vsmConsumerWgsl(${vsmBindingsLabel(b)}, ${transmission}, ${pool}, ${shadowKindsLabel(kinds)})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_UNIFORMS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_STRUCTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_NORMAL_OFFSET_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      vsmProjectionSampleWgsl(pool ? forwardPool(b.pool) : RESOLVE_POOL),
      vsmTransmissionReadWgsl(transmission),
      perspectiveDivide,
    ],
    `
@group(0) @binding(${b.uniforms}) var<uniform> vsm:VsmUniforms;
@group(0) @binding(${b.pageTable}) var<storage,read> vsmPageTable:array<u32>;
fn vsmPageTableLoad(i:u32)->u32{return vsmPageTable[i];}
@group(0) @binding(${b.projectionData}) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;
/** The receiver \`P\` from the eye, pushed along its normal \`N\` by the normal bias the projection's
 *  trace pushes it by (\`vsmNormalOffset\`), at the point it reads: \`P\` shifted to the projection's
 *  origin, from its eye. */
fn vsmReceiverFromEye(P:vec3f,N:vec3f)->vec3f{
 let shifted=(P+vsmView.originShiftHigh)+vsmView.originShiftLow;
 return (P-shadowCamera)+N*vsmNormalOffset(shifted-vsmView.shiftedEye);
}
/** Where a receiver \`fromEye\` (\`vsmReceiverFromEye\`) is read in map \`id\`: its sample \`sm\` —
 *  invalid where no page holds the point, nothing mapped at any level —, whether it is a sun's
 *  clipmap level (\`clipmap\`), whose sample may fall back to a coarser one (\`sm.handle\`), or a
 *  local light's map, and the receiver in the map's shifted frame. */
struct VsmLocated{sm:VsmMapRead,clipmap:bool,fromMap:vec3f,}
fn vsmLocate(id:u32,directional:bool,fromEye:vec3f)->VsmLocated{
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return VsmLocated(vsmEmptyRead(),true,vec3f(0.0));}
  let requested=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(requested);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  return VsmLocated(vsmReadClipmap(requested,uvz.xy),true,fromMap);`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 let uvz=perspectiveDivide(pd.shiftedToMapUv*vec4f(fromMap,1.0));
 return VsmLocated(vsmReadMap(h,uvz.xy,pd.finestMip),false,fromMap);`,
 )}
}`,
  )
