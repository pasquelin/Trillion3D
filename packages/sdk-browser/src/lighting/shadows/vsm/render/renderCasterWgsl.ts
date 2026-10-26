import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { PAGE_GEOMETRY_WGSL } from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { VSM_F32_BELOW_ONE } from '../constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'

/**
 * A caster corner's projection on a VSM
 * view: the world position of a row's vertex, composed as the shadow depth pass composes it; the
 * translated world; the clip position, a sun level's corner in front of its near plane flattened
 * onto it (the greatest depth an f32 holds below 1, 1 − 2^-24, the nearest the clip volume keeps
 * strictly inside, so that no rounding of the clip test drops it; every receiver of the level lies
 * at a depth of at most 1 behind it).
 */
export const VSM_CASTER_PROJECTION_WGSL = wgslBlock(
  'VSM_CASTER_PROJECTION_WGSL',
  [PAGE_INFO_WGSL, PAGE_GEOMETRY_WGSL, VSM_PROJECTION_DATA_WGSL],
  `
/** World position of a row's vertex, composed as the shadow depth pass composes it. */
fn vsmRenderWorld(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{return (page.world*vec4f(pagePosition(page,h,vertex),1.0)).xyz;}
/** The world position in the VSM view's translated world. */
fn vsmRenderShifted(raw:VsmProjectionRecord,world:vec3f)->vec3f{return (world+raw.originShiftHigh)+raw.originShiftLow;}
/** The clip position of a translated world point; \`flatten\` sends a point in front of the near plane onto it. */
fn vsmRenderClip(raw:VsmProjectionRecord,shifted:vec3f,flatten:bool)->vec4f{
 let m=raw.shiftedToMapUv*vec4f(shifted,1.0);
 return select(m,vec4f(m.xy,${VSM_F32_BELOW_ONE},1.0),flatten&&m.z>m.w);
}`,
)
