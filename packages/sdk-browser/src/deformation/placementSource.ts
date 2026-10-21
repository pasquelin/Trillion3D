import type { DeformationCapacity } from './source.ts'
import type { PlacementOf, PlacementRows } from '../placement/rows/rows.ts'
import type { DeformedMesh } from './frame.ts'
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { bankTrack } from '../../../sdk-core/src/scene/core/animationBanks.ts'

/** The largest record the sources of `rows` need, measured once for every root of them. */
function capacityOf(rows: PlacementRows, capacities: Map<PlacementRows, DeformationCapacity>) {
  let capacity = capacities.get(rows)
  if (!capacity) {
    capacity = { joints: 0, waves: 0 }
    for (const model of rows.sourceModels ?? rows.sources ?? []) {
      capacity.joints = Math.max(capacity.joints, model?.skeleton?.bones.length ?? 0)
      capacity.waves = Math.max(capacity.waves, model?.waves?.waveModel.count ?? 0)
    }
    capacities.set(rows, capacity)
  }
  return capacity
}

/** The track row `index` of `rows` plays now (`PlacementRows.tracks`), none while it plays none:
 *  the one object of its item (`bankTrack`), so a read allocates nothing. */
function rowTrack(rows: PlacementRows, index: number) {
  const item = rows.tracks?.[index] ?? -1
  return item >= 0 && rows.banks ? bankTrack(rows.banks, item) : undefined
}

/** Mirroring shares geometry and material; a row still reads its own original animation source:
 *  its skeleton, morph weights, waves and the simulation a cooked soft body writes back
 *  (`softSource.ts`), or the track of the scene's animation banks it plays — its row's while a
 *  cell places an instanced skinned object on it, else its source mesh's own (`Mesh.bank`). Each
 *  is read on the row `owner` stands on now: a growth moves it onto the same row of a larger
 *  buffer (`placement/growth/growth.ts`), whose tracks are a column of its own. Rows with neither
 *  sources nor banks are read through `fallback`, the mesh drawing every one of them. */
export function placementDeformation(
  owner: { readonly placement?: PlacementOf },
  fallback: DeformedMesh,
  capacities: Map<PlacementRows, DeformationCapacity>,
) {
  const rows = owner.placement?.rows
  if (!rows || (!rows.sources && !rows.banks)) return { mesh: fallback }
  const capacity = rows.sources ? capacityOf(rows, capacities) : undefined
  /** The mesh the row reads its sources from now: its own original, or the one drawing them all. */
  const current = (): (Mesh<object> & Pick<DeformedMesh, 'softSource'>) | DeformedMesh | null => {
    const { rows, index } = owner.placement!
    return rows.sources ? rows.sources[index] : fallback
  }
  const mesh: DeformedMesh = {
    get sourceIdentity() {
      return owner.placement!.rows.sources ? (current() ?? null) : fallback.sourceIdentity
    },
    get skeleton() {
      return current()?.skeleton
    },
    get morphTargetInfluences() {
      return current()?.morphTargetInfluences
    },
    get waves() {
      return current()?.waves
    },
    get softSource() {
      return current()?.softSource
    },
    // The rows of a model's meshes stand in the world; their bones in the model's graph.
    get frame() {
      const { rows, index } = owner.placement!
      return rows.local ? rows.sources?.[index]?.matrixWorld.elements : undefined
    },
    get bank() {
      const { rows, index } = owner.placement!
      return rowTrack(rows, index) ?? current()?.bank
    },
  }
  return { mesh, capacity }
}
