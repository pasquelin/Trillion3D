import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/**
 * WHAT A CLUSTER IS, FOR EVERY PLACEMENT THAT DRAWS IT: one record a UNIQUE cluster — the record
 * rank of the cut's hot and cold tables (`../layout.ts`), shared by the placements of a primitive —,
 * never a record a drawn cluster of a placement. The host writes it once, when the cluster's page is
 * in its pool slot, moves, or its surface changes (`./clusterInfoWrite.ts`); the GPU measures the
 * longest edge once (`./measureWgsl.ts`). What a placement adds — its world, its deformation, its
 * offset's switches — is read from the placement's own tables when a visible cluster is decoded
 * (`../../../visibility/decode/decodeWgsl.ts`).
 *
 * `flags` are the geometry's flags with its surface's (`PageInfo.flags`): the cut reads them to
 * hand a line, a sprite or a voxel brick to the hardware raster. The longest edge of the cluster's
 * triangles in its own space, which the cut judges the software raster by, lies in a buffer of its
 * own, one f32 a record (`CLUSTER_EDGE_BYTES`), zero until measured: a cluster of an unmeasured
 * edge goes to the hardware raster, which draws any. The others are the page-table words of the same name (`../../../visibility/pageInfo.ts`)
 * that no placement decides: `wpo` and `wpoMost` are the surface's own, before its object's. `displacementReach` is the greatest distance the surface's displacement moves a point, in the geometry's own units, and `displacementFadeOut` the on-screen size in pixels under which the displacement has faded out wholly: zero where the surface is not displaced, never fades, or is masked (a masked surface is never drawn as its base triangles on that account). The shadow maps' raster reads both to draw the base triangles of a surface whose displacement is gone (`vsmRenderFallsBack`).
 */
export const CLUSTER_INFO = fieldLayout('ClusterInfo', [
  ['flags', 'u32'],
  ['pageOffset', 'u32'],
  ['indexCount', 'u32'],
  ['vertexBase', 'u32'],
  ['clusterHash', 'u32'],
  ['material', 'u32'],
  ['materialClass', 'u32'],
  ['depthBias', 'u32'],
  ['diagnosticWord', 'u32'],
  ['wpo', 'u32'],
  ['wpoMost', 'f32'],
  ['displacementReach', 'f32'],
  ['displacementFadeOut', 'f32'],
] as const)

/** Words of a record, and its bytes. */
export const CLUSTER_INFO_WORDS = CLUSTER_INFO.words,
  CLUSTER_INFO_BYTES = CLUSTER_INFO.words * 4

/** Bytes of a cluster's measured longest edge, one f32 apiece in a buffer of its own
 *  (`./measureWgsl.ts`): what the GPU writes is not what the host writes. */
export const CLUSTER_EDGE_BYTES = 4
