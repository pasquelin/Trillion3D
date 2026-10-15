import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { faceNormal } from '../../../math/src/wgsl/geometry.ts'
import { matrixWindingCw } from '../../../math/src/wgsl/matrix.ts'
import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_WGSL } from '../visibility/shader/pageWgsl.ts'
import { VSM_F32_BELOW_ONE } from './constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'

/**
 * What the opaque raster and the transmission bin share of a caster corner's projection on a VSM
 * view: the world position of a row's vertex, composed as the shadow depth pass composes it; the
 * translated world; the clip position, a sun level's corner in front of its near plane flattened
 * onto it (the greatest depth an f32 holds below 1, 1 − 2^-24, the nearest the clip volume keeps
 * strictly inside, so that no rounding of the clip test drops it; every receiver of the level lies
 * at a depth of at most 1 behind it); and whether a triangle faces the light — toward
 * −light-direction for an orthographic view (the reversed-Z clip z gradient), toward the light
 * position (the shifted origin) for a perspective one — its counter-clockwise normal flipped by a
 * mirroring placement, the main raster's \`windingCw\`.
 */
export const VSM_CASTER_PROJECTION_WGSL = wgslBlock(
  'VSM_CASTER_PROJECTION_WGSL',
  [PAGE_INFO_WGSL, PAGE_GEOMETRY_WGSL, VSM_PROJECTION_DATA_WGSL, matrixWindingCw, faceNormal],
  `
/** World position of a row's vertex, composed as the shadow depth pass composes it. */
fn vsmRenderWorld(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{return (page.world*vec4f(pagePosition(page,h,vertex),1.0)).xyz;}
/** The world position in the VSM view's translated world. */
fn vsmRenderShifted(raw:VsmProjectionRecord,world:vec3f)->vec3f{return (world+raw.originShiftHigh)+raw.originShiftLow;}
/** The clip position of a translated world point; \`flatten\` sends a point in front of the near plane onto it. */
fn vsmRenderClip(raw:VsmProjectionRecord,shifted:vec3f,flatten:bool)->vec4f{
 let m=raw.shiftedToMapUv*vec4f(shifted,1.0);
 return select(m,vec4f(m.xy,${VSM_F32_BELOW_ONE},1.0),flatten&&m.z>m.w);
}
/** Whether the counter-clockwise triangle (a,b,c) of the row faces the VSM view \`raw\`; \`twA\` is \`a\` translated. */
fn vsmRenderFacesLight(page:PageInfo,raw:VsmProjectionRecord,a:vec3f,b:vec3f,c:vec3f,twA:vec3f)->bool{
 let mirrored=matrixWindingCw(page.world);
 var n=faceNormal(a,b,c);
 if(mirrored){n=-n;}
 let uv=raw.shiftedToMapUv;
 let isOrtho=raw.lightViewToClip[3][3]>=1.0;
 // Toward the light: the clip z gradient (reversed Z, nearer = larger) for an orthographic view,
 // the shifted origin (originShift = −light position) for a perspective one.
 let toLight=select(-twA,vec3f(uv[0].z,uv[1].z,uv[2].z),isOrtho);
 return dot(n,toLight)>0.0;
}`,
)
