import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { createPlacementRows } from '../../placement/rows.ts'
import { LoadedModel } from './loadedModel.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldRanks } from './worldRanks.ts'

/** The models of a world that loaded none: posing a model there writes nothing. */
export const noModels = () => createWorldModels(createWorldRanks())

/** The links of `count` meshes, ranked in order. */
export const meshLinks = (count: number) => Array.from({ length: count }, (_, i) => ({ meshes: i }))

/** A model whose graph holds a mesh for each of `links` — its association —, the one shape of a
 *  loaded one a world reads: its manifest's primitives, its graph, its `partitions` and where its
 *  images were read, nothing of its pages. */
export function loadedModel(
  links: readonly { meshes: number; placements?: ReturnType<typeof createPlacementRows> }[],
  {
    textureSource = 'host',
    partitions = [],
  }: { textureSource?: 'cache' | 'host'; partitions?: object[] } = {},
) {
  const source = new Group(),
    drawn = links.map(() => new Mesh(new Geometry(), new Material('meshStandard')))
  source.add(...drawn)
  const associations = new Map(drawn.map((mesh, i) => [mesh, links[i]]))
  const primitives = links.map((link) => ({ mesh: link.meshes, primitive: 0, pages: [] }))
  const loaded = new LoadedModel({
    base: 'file:///cache/',
    manifestUrl: 'file:///cache/manifest.json',
    metadataUrl: 'file:///cache/clusters.json',
    textureSource,
    metadata: { primitives } as never,
    scene: { source, associations, partitions } as never,
  })
  return { loaded, drawn, source }
}
