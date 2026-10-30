import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { globalDistanceFieldTraceWgsl } from '../../distanceField/globalTraceWgsl.ts'
import { DFSH_MAX_LIGHTS } from '../../distanceField/shadow/layout.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { MESH_SUN_TRACE_WGSL, SAME_SUN } from './meshShadowWgsl.ts'
import {
  SHADOW_MASK_BINDINGS as B,
  SHADOW_MASK_TYPE_SLOTS,
  shadowMaskCommonWgsl,
} from './shadowMaskWgsl.ts'
import { shadowTraceMasks } from './shadowTraceWgsl.ts'

/**
 * THE SHADOW PASS THROUGH THE DISTANCE FIELDS: the masks of the light tiles (`shadowMaskWgsl.ts`) settled by a ray marched through the global
 * distance field, in the place of the scene's triangles (`shadowTraceWgsl.ts`). A workgroup a light tile, a thread a texel, over the same
 * light tiles and the same dispatch arguments as the masks of the lights together and of each batchable type (`fieldShadowLights`, `fieldShadowPoint`,
 * `fieldShadowSpot`, `fieldShadowRect`), a texel whose mask is settled left as it is. The ray runs from the texel to the light, as far as the lighting's
 * trace reaches or the lamp is; it starts off the surface by `shadowBias` voxels of the clipmap it begins in, three where the surface turns from the light
 * (`shadowRayBias`), a lamp's ray ending a bias short of it; where it meets a surface the texel's factor becomes 0, else it is kept. The texel is settled either way.
 *
 * A sun whose meshes' fields are listed for the cards (`meshShadow.ts`) is traced first, by `fieldShadowMeshLights` over the lights together, through those
 * meshes (`dfshTraceThroughTile`): the ray starts off the texel by the mesh bias, three times that where the surface grazes the sun, and goes as far as the
 * trace reaches; the texel's factor is multiplied by the visibility it finds, the texel settled. That pass leaves any other light's texels as they are, for
 * the global field's pass that follows.
 *
 * Both bind, in group 0, the parameters (0), the tables (1), the light tiles' counters (2), the depth and normal layers (3, 4), the light tiles (5), the
 * masks (6) and the lights (7) as the masks do; `fieldShadow` the global field from `FIELD_SHADOW_FIRST`, `fieldShadowMesh` the suns' lists in the group `MESH_SHADOW_GROUP`.
 */

/** The first binding of the global distance field's reads in the program that marches through it, clear of the masks'. */
export const FIELD_SHADOW_FIRST = 20

/** The entries of the pass through the global field, as the masks' (`SHADOW_MASK_ENTRIES`): the lights together, then the point lights', the spots' and the rectangles'. */
export const FIELD_SHADOW_ENTRIES = [
  'fieldShadowLights',
  'fieldShadowPoint',
  'fieldShadowSpot',
  'fieldShadowRect',
] as const
/** The entry of the pass through the suns' meshes: the suns lie among the lights together. */
export const FIELD_SHADOW_MESH_ENTRY = 'fieldShadowMeshLights'

const declarations = `@group(0) @binding(${B.lightTiles}) var<storage,read> lightTiles:array<u32>;
@group(0) @binding(${B.masks}) var<storage,read_write> masks:array<atomic<u32>>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;`

const fieldRay = `/** The distance, in voxels, a shadow ray starts off a texel whose normal makes the cosine nDotL with the light. */
fn shadowRayBias(nDotL:f32,bias:f32)->f32{return bias+2.0*bias*saturate(1.0-nDotL);}
/** Whether the ray from the world point at along toward, span long, meets a surface of the global field. */
fn cacheShadowed(at:vec3f,normal:vec3f,toward:vec3f,span:f32,lamp:bool)->bool{
 var ray=gdfTraceInput(gdfTranslated(at),toward,0.0,span,1.0,1.0);
 ray.rayBias=shadowRayBias(dot(normal,toward),lp.shadowBias);
 if(lamp){ray.rayEndBias=lp.shadowBias;}
 return gdfTrace(ray).hitTime>=0.0;
}
/** The byte of a texel answered: kept where the ray meets nothing, else zero. */
fn traceAnswer(texel:SurfaceTexel,rank:u32,byte:u32)->u32{
 let light=directLights.items[rank];
 let sun=isSun(light);
 let offset=light.positionRange.xyz*CM_PER_M-texel.position;
 let toward=select(normalize(offset),-light.directionCone.xyz,sun);
 let span=select(min(length(offset),lp.maxTrace),lp.maxTrace,sun);
 return select(byte,0u,cacheShadowed(texel.position,texel.normal,toward,span,!sun));
}`

/** The byte a texel answers with when its program does not answer for its light (the suns' meshes program, for any other light): the texel is left as it is. */
const SKIP = '0xffffffffu'

const meshRay = `/** The byte of a texel answered through the meshes of the sun's lists: the factor times the visibility they leave; a texel of any other light is left. */
fn traceAnswer(texel:SurfaceTexel,rank:u32,byte:u32)->u32{
 let light=directLights.items[rank];
 if(!isSun(light)){return ${SKIP};}
 let toward=-light.directionCone.xyz;
 for(var sun=0u;sun<${DFSH_MAX_LIGHTS}u;sun++){
  if(dfshSuns[sun].tiles.x==0u||dot(dfshSuns[sun].light.xyz,toward)<${SAME_SUN}){continue;}
  let start=texel.position-lp.camera.xyz+toward*(dfshSuns[sun].range.w*(1.0+2.0*saturate(1.0-dot(toward,texel.normal))));
  let visibility=dfshTraceThroughTile(sun,start,start+toward*lp.maxTrace);
  return shadowByteOf(ShadowRay(shadowRayOf(byte).factor*visibility,false));
 }
 return ${SKIP};
}`

/** The light tiles \`first\` up to \`end\` of the compacted list, a workgroup each, a thread a texel: the texels the masks left unsettled are answered by \`traceAnswer\`. */
const fieldTiles = (
  skips: boolean,
) => `fn fieldShadowTiles(first:u32,end:u32,group:vec3u,n:vec3u,at:vec2u){
 let lightTile=first+flatGroup(group,n);
 // The dispatch's rows may hold groups past its tiles: they leave together.
 if(lightTile>=end){return;}
 let byte=maskByteAt(lightTile,at);
 if((byte&SHADOW_COMPLETE)!=0u){return;}
 let packed=lightTiles[lightTile*LIGHT_TILE_WORDS];
 let rank=tileLightRank(lightTiles[lightTile*LIGHT_TILE_WORDS+1u]);
 let answered=traceAnswer(surfaceTexel(tilePage(packed),tileCoordOf(packed)*LG_TILE+at),rank,byte);${skips ? `\n if(answered==${SKIP}){return;}` : ''}
 setMaskByte(lightTile,at,byte,answered|SHADOW_COMPLETE);
}`

const entry = (name: string, tiles: string) =>
  `@compute @workgroup_size(8,8,1)
fn ${name}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 let tiles=${tiles};
 fieldShadowTiles(tiles.x,tiles.y,group,n,at.xy);
}`

const fieldEntries = [
  entry('fieldShadowLights', 'perLightTiles()'),
  ...(['Point', 'Spot', 'Rect'] as const).map((kind) =>
    entry(
      `fieldShadow${kind}`,
      `slotTiles(${SHADOW_MASK_TYPE_SLOTS[`shadowMask${kind}` as const]}u)`,
    ),
  ),
].join('\n')

const fieldShadowProgram = (format: AtlasFormat, filterableMip: boolean) =>
  wgslProgram(
    `${declarations}
${shadowTraceMasks}
${fieldRay}
${fieldTiles(false)}
${fieldEntries}`,
    [...shadowMaskCommonWgsl(format), globalDistanceFieldTraceWgsl(0, FIELD_SHADOW_FIRST, filterableMip)],
  )

const fieldShadowMeshProgram = (format: AtlasFormat) =>
  wgslProgram(
    `${declarations}
${shadowTraceMasks}
${meshRay}
${fieldTiles(true)}
${entry(FIELD_SHADOW_MESH_ENTRY, 'perLightTiles()')}`,
    [...shadowMaskCommonWgsl(format), MESH_SUN_TRACE_WGSL],
  )

/** The pass through the global field over masks in the grey format, and over those of the light functions' coloured atlas, the coarse mip read by hand. */
export const FIELD_SHADOW_WGSL = fieldShadowProgram('grey', false)
export const FIELD_SHADOW_COLOURED_WGSL = fieldShadowProgram('colour', false)
/** The pass through the suns' meshes over masks in the grey format, and in the coloured one. */
export const FIELD_SHADOW_MESH_WGSL = fieldShadowMeshProgram('grey')
export const FIELD_SHADOW_MESH_COLOURED_WGSL = fieldShadowMeshProgram('colour')

/** The pass through the global field over masks in `format` (the grey one, or the light functions' coloured atlas), the coarse mip read through
 *  the hardware's filter where `filterableMip`, as in the kernel's layout (`kernels.ts`). */
export const fieldShadowProgramOf = (format: AtlasFormat, filterableMip: boolean) =>
  fieldShadowProgram(format, filterableMip)
export const fieldShadowMeshProgramOf = (format: AtlasFormat) =>
  format === 'colour' ? FIELD_SHADOW_MESH_COLOURED_WGSL : FIELD_SHADOW_MESH_WGSL
