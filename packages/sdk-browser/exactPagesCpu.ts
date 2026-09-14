import { disabledStageProfile } from '../sdk-core/index.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { createStageProfiler } from './stageProfiler.ts';
import { WEBGL_STAGES } from './stageMapping.ts';
import type { BackendContext } from './backendTypes.ts';

/** L'étape publique de chaque borne du moteur WebGL2 ; `null` pour la somme, qui ne se dépose pas. */
const STEP_STAGES: ReadonlyArray<string | null> = [
  'animations',
  'lights',
  'selection',
  'uploads',
  'residency',
  'residency',
  'residency',
  'submit',
  null,
];

export function createExactPagesCpu(
  onDiagnostic: BackendContext['onDiagnostic'],
  getFrame: () => number,
  enabled = false,
  getCutMs: () => number = () => 0,
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
  const stages = enabled
    ? createStageProfiler({
        backend: 'exact-cluster-pages',
        stages: WEBGL_STAGES,
        gpuMethod: null,
        gpuReason: 'WebGL2 ne délimite pas de passe : seule l’image entière est chronométrable',
      })
    : undefined;
  let cpuLogMs = 0,
    cpuLogFrame = -1;
  const methods = {
    /** La durée carte graphique de l'image entière, relevée par l'extension quand elle existe. */
    gpuImageMs(ms: number | null, supported: boolean, reason: string | null) {
      if (!stages) return;
      if (!supported) stages.setGpuMethod(null, reason);
      else {
        stages.setGpuMethod('EXT_disjoint_timer_query_webgl2', null);
        if (ms !== null) stages.pushImageGpu(ms);
      }
    },
    resetStageProfile() {
      stages?.reset();
    },
    /** Le profil public : « non mesuré » partout où rien n'a été relevé, jamais un zéro. */
    stageProfile() {
      return (
        stages?.profile() ??
        disabledStageProfile('exact-cluster-pages', 'profil par étape non demandé par l’hôte')
      );
    },
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
      stages?.frameCpu((add) => {
        for (let i = 0; i < STEP_STAGES.length; i++) {
          const stage = STEP_STAGES[i];
          if (stage) add(stage, row[i]);
        }
        // La coupe hiérarchique est bornée à l'intérieur de `selectMs` par le moteur lui-même.
        add('hierarchyCut', getCutMs());
        add('frame', total);
      });
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
