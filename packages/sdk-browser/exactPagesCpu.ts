import { createCpuStepProfile } from './cpuProfile.ts';
import type { BackendContext } from './backendTypes.ts';

export function createExactPagesCpu(
  onDiagnostic: BackendContext['onDiagnostic'],
  getFrame: () => number,
) {
  // Profil CPU par étape, publié en mode `summary` : allumer la trace par image changerait la mesure.
  // `arrivals`, `pending`, `retain` et `submit` sont relevées par l'hôte, qui les dépose ici.
  const CPU_STEPS = [
    'worldMs',
    'lightsMs',
    'selectMs',
    'syncMs',
    'arrivalsMs',
    'pendingMs',
    'retainMs',
    'submitMs',
    'totalMs',
  ] as const;
  const cpuProfile = createCpuStepProfile(CPU_STEPS);
  let cpuLogMs = 0,
    cpuLogFrame = -1;
  const methods = {
    /** Dépose la durée d'une étape mesurée par l'hôte : arrivées, attente, rétention, soumission. */
    cpuStep(index: number, ms: number) {
      if (index >= 0 && index < CPU_STEPS.length) cpuProfile.row[index] = ms;
    },
    /** Clôt l'image : total, classement, et publication au plus une fois toutes les deux secondes. */
    cpuFrameEnd() {
      const frame = getFrame();
      const row = cpuProfile.row;
      let total = 0;
      for (let i = 0; i < CPU_STEPS.length - 1; i++) total += row[i];
      row[CPU_STEPS.length - 1] = total;
      cpuProfile.record(frame, total);
      const now = performance.now();
      if (now - cpuLogMs < 2000 || frame === cpuLogFrame) return;
      cpuLogMs = now;
      cpuLogFrame = frame;
      const steps = cpuProfile.summary();
      if (!steps) return;
      try {
        onDiagnostic?.({
          phase: 'cpu-timing',
          message: 'Durées CPU mesurées dans le moteur',
          context: {
            version: 1,
            engine: 'exact-cluster-pages',
            frame,
            scope: 'backend-render-and-host-draw',
            steps,
          },
        });
      } catch {
        /* Les observateurs ne pilotent pas le rendu. */
      }
    },
  };
  return { profile: cpuProfile, methods };
}
