/**
 * THE MESHES A PAGE DRAWS: the core's meshes, wearing the engine's surface records (`surface.ts`),
 * held by identity by the draw record, the transparent table and the selection sets.
 */
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { InstancedMesh } from '../../../../sdk-core/src/world/object/instancedMesh.ts'
import type { PageSurface } from './surface.ts'

/** What a mesh wears: the surface record of its material, or one per geometry group. */
export type PageMaterials = PageSurface | PageSurface[]

/** A drawn node of the graph. */
export type PageMesh = Mesh<PageSurface>
/** A drawn node of the graph at several placements, one matrix each. */
export type PageInstancedMesh = InstancedMesh<PageSurface>
