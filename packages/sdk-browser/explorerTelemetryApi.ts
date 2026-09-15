import { disabledStageProfile, type StageProfile } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { EngineProfiler, TelemetryReport } from './telemetry.ts';

export function createExplorerTelemetryApi(profiler: EngineProfiler, active: () => RenderBackend) {
  return {
    profiler,
    getReport(): TelemetryReport {
      return profiler.getReport();
    },
    /**
     * Le profil par étape du moteur actif : une ligne par étape, p50 et p95, durée processeur et
     * durée carte graphique séparées et jamais additionnées. « Non mesuré » vaut `null`, jamais `0`.
     * Vide tant que `stageProfile: true` n'a pas été demandé à `createExplorer`.
     */
    stageProfile(): StageProfile {
      const backend = active();
      return (
        backend.stageProfile?.() ??
        disabledStageProfile(backend.id, 'ce moteur ne chronomètre pas ses étapes')
      );
    },
    /**
     * L'empreinte de l'atlas d'ombres du moteur actif, bit pour bit, ou `null` quand il n'en tient
     * pas. Deux exécutions de la même scène — l'une redessinant les faces entières, l'autre
     * seulement les pages invalidées — doivent rendre la même empreinte une fois la file vide.
     */
    shadowAtlasDigest() {
      return active().shadowAtlasDigest?.() ?? Promise.resolve(null);
    },
    /** Vide la fenêtre du profil du moteur actif, pour ne mesurer que ce qui vient ensuite. */
    resetStageProfile() {
      active().resetStageProfile?.();
    },
    printReport() {
      profiler.printReport();
    },
    enableAutoLog(intervalSeconds = 2) {
      return profiler.startAutoLog(intervalSeconds);
    },
    disableAutoLog() {
      profiler.stopAutoLog();
    },
  };
}
