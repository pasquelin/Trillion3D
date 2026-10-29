import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  storageEntries,
} from '../../../gpu/core/computeBindings.ts'
import { sceneObjectEntries } from '../../distanceField/sceneBindings.ts'
import { dfshCommonWgsl } from '../../distanceField/shadow/commonWgsl.ts'
import {
  DFSH_BINDING as B,
  DFSH_MAX_LIGHTS,
  DFSH_PARAMS_BYTES,
} from '../../distanceField/shadow/layout.ts'
import { dfshTileTraceWgsl } from '../../distanceField/shadow/traceWgsl.ts'

/**
 * THE SUNS' SHADOW ON THE CARDS THROUGH THE MESHES' FIELDS, as the direct light's program reads it. For each sun that casts a shadow
 * (at most `DFSH_MAX_LIGHTS`) the meshes the cards' volume reaches are culled to it and listed by tile of the volume's shadow space across
 * it before the lighting (`meshShadow.ts`, with the lists' passes of `../../distanceField/shadow/`); the lists lie one after the other in the
 * bindings of those passes' table (`DFSH_BINDING`), with a uniform block a sun, and the program reads them in the bind group `MESH_SHADOW_GROUP`.
 *
 * `meshSunVisibility(position, normal, toward)` is the visibility the sun gives a texel, 0 to 1, or -1 where the texel's light
 * is none of those suns: the ray starts off the texel by the mesh bias (`range.w` of the sun's block, centimetres) and three times that where the
 * surface grazes the light, and is as long as the lighting's trace (`lp.maxTrace`); it is traced through the meshes of the
 * tile it starts in (`dfshTraceThroughTile`). The program without the fields has the same function answering -1.
 */
export const MESH_SHADOW_GROUP = 1

/** The storage buffers a stage of the pass that traces the suns binds: its three (the tables, the context, the visibility it stores) and the seven of the lists and the meshes' fields. The direct
 *  light binds fewer (its eight and the visibility it reads: nine). A device that grants fewer lights the suns through the global field. */
export const MESH_SUN_STORAGE_BUFFERS = 10

/** The cosine over which a light's direction is the direction of a sun that the lists were made for. */
const SAME_SUN = 0.9999

/** The binding, in the group `MESH_SHADOW_GROUP` of the direct light's program, of the visibility each texel has of each sun (`MESH_SUN_PREPASS_WGSL` writes it). */
export const MESH_SUN_VISIBILITY_BINDING = 1

/** The trace of a ray through the tile of the suns' lists it starts in (`dfshTraceThroughTile`), which the pass that runs before the direct light reads the lists by. */
export const MESH_SUN_TRACE_WGSL = wgslBlock(
  'MESH_SUN_TRACE_WGSL',
  [
    dfshCommonWgsl(MESH_SHADOW_GROUP, DFSH_MAX_LIGHTS),
    dfshTileTraceWgsl(MESH_SHADOW_GROUP, DFSH_MAX_LIGHTS),
  ],
  '',
)

/**
 * The program's reads of the suns' shadow: `meshSunVisibility` answers, for the sun whose direction the light's is, the visibility
 * the pass before the direct light stored for the texel the thread stands on (`meshTexel`, set by the thread), and -1 for a light none of the listed suns is.
 * Only the suns' uniform blocks and that visibility are bound: the lists and the meshes' fields are the pass before's, so that neither pass
 * binds more storage buffers than the device grants a stage.
 */
export const MESH_SUN_WGSL = wgslBlock(
  'MESH_SUN_WGSL',
  [dfshCommonWgsl(MESH_SHADOW_GROUP, DFSH_MAX_LIGHTS)],
  `@group(${MESH_SHADOW_GROUP}) @binding(${MESH_SUN_VISIBILITY_BINDING}) var<storage,read> meshSunVisible:array<f32>;
var<private> meshTexel:u32=0u;
fn meshSunVisibility(position:vec3f,normal:vec3f,toward:vec3f)->f32{
 for(var sun=0u;sun<${DFSH_MAX_LIGHTS}u;sun++){
  if(dfshSuns[sun].tiles.x==0u||dot(dfshSuns[sun].light.xyz,toward)<${SAME_SUN}){continue;}
  return meshSunVisible[meshTexel*${DFSH_MAX_LIGHTS}u+sun];
 }
 return -1.0;
}`,
)

/** The program that has no fields: no light is a sun traced through them. */
export const NO_MESH_SUN_WGSL = wgslBlock(
  'NO_MESH_SUN_WGSL',
  [],
  `
fn meshSunVisibility(position:vec3f,normal:vec3f,toward:vec3f)->f32{return -1.0;}`,
)

const { read } = storageEntries<'tileCounts' | 'tileOffsets' | 'tileData'>(B)

/** The layout of the group `MESH_SHADOW_GROUP` of the pass that traces the suns (`MESH_SUN_PREPASS_WGSL`): the suns' uniform blocks, their tiles' lists and the meshes' fields. */
export const meshShadowLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.params, { minBindingSize: DFSH_PARAMS_BYTES * DFSH_MAX_LIGHTS }),
  read('tileOffsets'),
  read('tileCounts'),
  read('tileData'),
  ...sceneObjectEntries(B.objects, true),
]

/** The layout of the group `MESH_SHADOW_GROUP` of the direct light's program: the suns' uniform blocks and the visibility the pass before stored. */
export const meshSunReadLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.params, { minBindingSize: DFSH_PARAMS_BYTES * DFSH_MAX_LIGHTS }),
  computeBufferEntry(MESH_SUN_VISIBILITY_BINDING, 'read-only-storage'),
]
