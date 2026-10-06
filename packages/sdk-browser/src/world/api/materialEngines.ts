/** What every material change asks the session's engines, whichever material it writes
 *  (`materialApi.ts`). */
import { EngineError } from '../../../../sdk-core/src/index.ts'
import type { RenderBackend } from '../../backend/types.ts'
import type { AlphaChange } from '../../placement/backendSceneUpdates.ts'

export function materialEngines(backends: RenderBackend[], active: () => RenderBackend) {
  return {
    /** An engine that lays out the class `alpha` moves to at open refuses it by name. */
    refuseClass(id: string, alpha: AlphaChange) {
      for (const backend of backends) {
        const why = backend.materialClassRefusal?.(alpha)
        if (why)
          throw new EngineError(
            'MATERIAL_CLASS_CHANGE',
            `${backend.id} cannot move material ${id} from ${alpha.from} to ${alpha.to}: ${why}`,
            { id, from: alpha.from, to: alpha.to, engine: backend.id },
          )
      }
    },
    /** The active engine rereads surfaces in place, or the change is refused before any write. */
    repaints(id: string) {
      const engine = active()
      if (!engine.refreshMaterials)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${engine.id} does not repaint materials in place`,
          { id },
        )
    },
    /** Every engine rereads its surfaces, each asked even once one has refused; one that cannot
     *  has not taken the change (`setClearColor`). */
    refreshed(alpha?: AlphaChange) {
      let taken = true
      for (const backend of backends)
        taken =
          !!backend.refreshMaterials && backend.refreshMaterials(true, alpha) !== false && taken
      return taken
    },
  }
}
