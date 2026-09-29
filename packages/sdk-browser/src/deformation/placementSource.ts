import type { DeformationCapacity } from './source.ts';
import type { PlacementOf, PlacementRows } from '../placement/rows.ts';
import type { DeformedMesh } from './frame.ts';

/** Mirroring shares geometry and material; a row still reads its own original animation source. */
export function placementDeformation(
  placement: PlacementOf | undefined,
  fallback: DeformedMesh,
  capacities: Map<PlacementRows, DeformationCapacity>,
) {
  if (!placement?.rows.sources) return { mesh: fallback };
  const { rows, index } = placement;
  let capacity = capacities.get(rows);
  if (!capacity) {
    capacity = { joints: 0, waves: 0 };
    for (const model of rows.sourceModels ?? rows.sources ?? []) {
      capacity.joints = Math.max(capacity.joints, model?.skeleton?.bones.length ?? 0);
      capacity.waves = Math.max(capacity.waves, model?.waves?.waveModel.count ?? 0);
    }
    capacities.set(rows, capacity);
  }
  const current = () => rows.sources?.[index];
  const mesh: DeformedMesh = {
    get sourceIdentity() {
      return current() ?? null;
    },
    get skeleton() {
      return current()?.skeleton;
    },
    get morphTargetInfluences() {
      return current()?.morphTargetInfluences;
    },
    get waves() {
      return current()?.waves;
    },
  };
  return { mesh, capacity };
}
