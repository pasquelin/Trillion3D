import type { PlacementOf } from '../placement/rows.ts';
import type { DeformedMesh } from './frame.ts';

/** Mirroring shares geometry and material; a row still reads its own original animation source. */
export function placementDeformation(placement: PlacementOf | undefined, fallback: DeformedMesh) {
  if (!placement?.rows.sources) return { mesh: fallback, models: [fallback] };
  const { rows, index } = placement;
  const models = [...(rows.sourceModels ?? [])];
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
  return { mesh, models };
}
