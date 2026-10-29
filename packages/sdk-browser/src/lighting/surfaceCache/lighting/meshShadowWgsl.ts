import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { computeUniformEntry, storageEntries } from '../../../gpu/core/computeBindings.ts'
import { sceneObjectEntries } from '../../distanceField/sceneBindings.ts'
import { dfshCommonWgsl } from '../../distanceField/shadow/commonWgsl.ts'
import {
  DFSH_BINDING as B,
  DFSH_MAX_LIGHTS,
  DFSH_PARAMS_BYTES,
} from '../../distanceField/shadow/layout.ts'
import { dfshTileTraceWgsl } from '../../distanceField/shadow/traceWgsl.ts'

/**
 * THE SUNS' SHADOW ON THE CARDS THROUGH THE MESHES' FIELDS, as the shadow pass of `fieldShadowWgsl.ts` reads it. For each sun that casts a shadow
 * (at most `DFSH_MAX_LIGHTS`) the meshes the cards' volume reaches are culled to it and listed by tile of the volume's shadow space across
 * it before the lighting (`meshShadow.ts`, with the lists' passes of `../../distanceField/shadow/`); the lists lie one after the other in the
 * bindings of those passes' table (`DFSH_BINDING`), with a uniform block a sun, and the pass reads them in the bind group `MESH_SHADOW_GROUP`.
 *
 * A ray is traced through the meshes of the tile it starts in (`dfshTraceThroughTile`): it starts off the texel by the mesh bias (`range.w` of the
 * sun's block, centimetres) and three times that where the surface grazes the sun, and is as long as the lighting's trace (`lp.maxTrace`).
 */
export const MESH_SHADOW_GROUP = 1

/** The storage buffers the shadow pass through the suns' meshes binds: its five (the tables, the light tiles' counters, the light tiles, the masks and the lights) and the five of the lists and the meshes' fields. A device that grants fewer shadows the suns through the global field. */
export const MESH_SUN_STORAGE_BUFFERS = 10

/** The cosine over which a light's direction is the direction of a sun that the lists were made for. */
export const SAME_SUN = 0.9999

/** The trace of a ray through the tile of the suns' lists it starts in (`dfshTraceThroughTile`), over the lists of the group `MESH_SHADOW_GROUP`. */
export const MESH_SUN_TRACE_WGSL = wgslBlock(
  'MESH_SUN_TRACE_WGSL',
  [
    dfshCommonWgsl(MESH_SHADOW_GROUP, DFSH_MAX_LIGHTS),
    dfshTileTraceWgsl(MESH_SHADOW_GROUP, DFSH_MAX_LIGHTS),
  ],
  '',
)

const { read } = storageEntries<'tileOffsets'>(B)

/** The layout of the group `MESH_SHADOW_GROUP` of the pass that traces the suns: the suns' uniform blocks, their tiles' lists in one buffer (at the binding `tileOffsets`) and the meshes' fields. */
export const meshShadowLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.params, { minBindingSize: DFSH_PARAMS_BYTES * DFSH_MAX_LIGHTS }),
  read('tileOffsets'),
  ...sceneObjectEntries(B.objects, true),
]
