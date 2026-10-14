/**
 * The host meshes of the prepared scene, one per primitive, each wearing the variant of its
 * material its geometry and its draw ask for (`../../page/surfaceVariant.ts`): what the graph
 * (`graph.ts`) hangs under its nodes.
 */
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { drawnTwoSided } from '../../../../sdk-core/src/physics/soft.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { PageSurface } from '../../page/surface.ts'
import { variantOf, type SurfaceVariant } from '../../page/surfaceVariant.ts'
import type { RowLink } from '../../partition/rows.ts'
import { weigh, type uniqueNames } from './nodes.ts'

/** What the meshes are built from: the table's meshes, each primitive's geometry, the surface of
 *  a material rank in a variant, and whether a cloth draws a primitive. */
export type MeshInputs = {
  meshes: TableDocument['meshes']
  geometryOf: (mesh: number, primitive: number) => Geometry
  materialOf: (rank: number, variant: SurfaceVariant) => Promise<PageSurface>
  /** Whether a cloth draws the primitive (`drawnTwoSided`), once its manifest lists it. */
  clothOf?: (mesh: number, primitive: number) => Promise<boolean>
}

/** The host meshes of `order`, each mesh's primitives, and the node each rank builds: a mesh, or
 *  a group of one mesh per primitive. */
export async function buildMeshes(
  inputs: MeshInputs,
  order: readonly number[],
  unique: ReturnType<typeof uniqueNames>,
  ranks: Map<Object3D, RowLink>,
) {
  const { meshes, geometryOf, materialOf, clothOf } = inputs
  // Meshes, in the order they were first named. Every surface is asked for before any is waited
  // on: their images load together, as the loader loaded them.
  const drawn = order.map((rank) =>
    meshes[rank].primitives.map((primitive, p) => {
      const geometry = geometryOf(rank, p)
      // The variant waits for the manifest to list the primitive: a cloth's is drawn on both faces.
      const cloth = clothOf?.(rank, p) ?? Promise.resolve(false)
      const material = cloth.then((twoSided) =>
        materialOf(primitive.material, variantOf(geometry, twoSided)),
      )
      return { geometry, material, cloth }
    }),
  )
  // Each mesh is named when its surfaces are ready, as the loader named it: meshes whose
  // surfaces land together keep the order they were first named in. The ranks are recorded
  // afterwards in that first order, whatever order the images landed in.
  const made = await Promise.all(
    order.map((rank, at) =>
      Promise.all(drawn[at].map(({ material }) => material)).then((surfaces) =>
        drawn[at].map(({ geometry }, p) => {
          const mesh = new Mesh(geometry, surfaces[p])
          if (Object.keys(geometry.morphAttributes).length) weigh(mesh, meshes[rank].weights)
          mesh.name = unique(meshes[rank].name || `mesh_${rank}`)
          return mesh
        }),
      ),
    ),
  )
  // A cloth's primitive says so in its association: what a surface given to it later asks for.
  const cloths = await Promise.all(drawn.map((parts) => Promise.all(parts.map((d) => d.cloth))))
  const built = new Map<number, Object3D>()
  for (const [at, rank] of order.entries()) {
    const parts = made[at]
    parts.forEach((mesh, p) =>
      ranks.set(mesh, {
        meshes: rank,
        primitives: p,
        ...(cloths[at][p] ? { twoSided: true } : {}),
      }),
    )
    if (parts.length === 1) built.set(rank, parts[0])
    else {
      const group = new Group()
      ranks.set(group, { meshes: rank })
      for (const part of parts) group.add(part)
      built.set(rank, group)
    }
  }
  return { made, built }
}

/** Whether a cloth draws primitive `primitive` of mesh `mesh`: the soft body kind the compiler
 *  wrote into the primitive's deformation (`drawnTwoSided`), in the manifest read whole. */
export function clothPrimitives(metadata: ClusterManifest) {
  const cloths = new Set(
    metadata.primitives
      .filter((p) => drawnTwoSided(p.deformation?.softKind))
      .map((p) => `${p.mesh}:${p.primitive}`),
  )
  return async (mesh: number, primitive: number) => cloths.has(`${mesh}:${primitive}`)
}
