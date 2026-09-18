import type { GpuPassTimings } from '../sdk-core/index.ts';
import { gpuPassBlockOf, gpuPassStageOf, gpuTotalsBy, type GpuPassBlock } from './stageMapping.ts';

export { gpuPassBlockOf, gpuPassStageOf, type GpuPassBlock };

export type GpuPassBlockTotals = {
  visibilityMs: number | null;
  materialsMs: number | null;
  otherMs: number | null;
};

/**
 * La durée carte graphique de chaque bloc d'un relevé (`stageMapping.ts` dit lequel est lequel).
 *
 * `null` partout pour un relevé absent ou tronqué, et `null` pour un bloc dont une passe n'a pas de
 * durée utilisable : une somme partielle passerait pour une mesure. `null` aussi pour un bloc que
 * l'image n'a pas eu — un zéro se lirait comme « mesuré à zéro ». La somme des trois blocs vaut
 * `totalMs` du relevé quand les trois sont mesurés, et ne s'ajoute jamais à une durée processeur.
 */
export function gpuPassBlockTotals(sample: GpuPassTimings | null | undefined): GpuPassBlockTotals {
  const totals = gpuTotalsBy(sample, gpuPassBlockOf);
  return {
    visibilityMs: totals.get('visibility') ?? null,
    materialsMs: totals.get('materials') ?? null,
    otherMs: totals.get('other') ?? null,
  };
}
