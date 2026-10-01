import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { meshes } from '../../scene/meshes.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import { preparedVariantsOf } from '../../host/prepared/materialVariants.ts';
import { materialEngines } from './materialEngines.ts';

/** Imported variant sets share assignment/refusal/refresh with the live material API. */
export function materialVariantApi(inputs: {
  check: () => void;
  source: Object3D;
  backends: RenderBackend[];
  active: () => RenderBackend;
  beforeAssign: () => void;
  assigned: (mesh: object) => void;
}) {
  const { check, source, backends, active } = inputs;
  const engines = materialEngines(backends, active);
  const listed = () => {
    const entries = new Map<string, { id: string; name: string }>();
    for (const mesh of meshes(source)) {
      const group = preparedVariantsOf(mesh)?.group;
      group?.names.forEach((name, rank) => {
        const id = `${group.id}/${rank}`;
        entries.set(id, { id, name });
      });
    }
    return [...entries.values()];
  };
  return {
    /** Imported sets, preserving source scopes and duplicate names through distinct IDs. */
    materialVariants() {
      check();
      return listed();
    },
    /** Select an imported set; null restores the original materials in every imported model. */
    selectMaterialVariant(id: string | null) {
      check();
      if (id !== null && !listed().some((entry) => entry.id === id))
        throw new EngineError('UNKNOWN_MATERIAL', 'Unknown material variant', { id });
      inputs.beforeAssign();
      const changes = [];
      for (const mesh of meshes(source)) {
        const prepared = preparedVariantsOf(mesh);
        if (!prepared || (id !== null && !id.startsWith(`${prepared.group.id}/`))) continue;
        const rank = id === null ? -1 : Number(id.slice(id.lastIndexOf('/') + 1));
        const surface = prepared.surfaces.get(rank) ?? prepared.original;
        const change = {
          surfaces: [surface],
          meshes: new Map([[mesh, surface]]),
          from: alphaModeOf(firstMaterial(mesh.material)!),
          to: alphaModeOf(surface),
        };
        engines.refuseClass(id ?? 'default', change);
        changes.push(change);
      }
      // Validate every backend and every primitive before assigning even the first surface.
      engines.repaints(id ?? 'default');
      if (backends.some((backend) => !backend.wearSurface))
        throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'Backend cannot assign variant surfaces');
      for (const change of changes) {
        for (const [mesh, surface] of change.meshes) {
          mesh.material = surface;
          inputs.assigned(mesh);
        }
        for (const backend of backends) backend.wearSurface!(change);
      }
      let taken = true;
      for (const change of changes) taken = engines.refreshed(change) && taken;
      return taken;
    },
  };
}
