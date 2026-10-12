import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { createPlacementRows } from '../../placement/rows.ts'
import type { LoadedModel } from './loadedModel.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldRanks } from './worldRanks.ts'

/** The models of a world that loaded none: posing a model there writes nothing. */
export const noModels = () => createWorldModels(createWorldRanks())

/** A model whose graph holds `meshes`, each with its association: the shape of a loaded one a
 *  world reads, nothing of its pages. */
export function model(
  links: { meshes: number; placements?: ReturnType<typeof createPlacementRows> }[],
) {
  const source = new Group(),
    drawn = links.map(() => new Mesh(new Geometry(), new Material('meshStandard')))
  source.add(...drawn)
  const associations = new Map(drawn.map((mesh, i) => [mesh, links[i]]))
  const metadata = { primitives: links.map((link) => ({ mesh: link.meshes })) }
  const loaded = Object.assign(new Object3D(), {
    isLoadedModel: true,
    record: { metadata, scene: { source, associations } },
  }) as unknown as LoadedModel
  return { loaded, drawn, source }
}
