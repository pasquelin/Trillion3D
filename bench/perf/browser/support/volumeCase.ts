// Batch M2's volume cases mix concrete input/output types across boxes, spheres, frustum planes
// and the normal cone. `casVolume` binds each case's `measure` call to its own `Entree`/`Sortie`
// at the point they are concrete, and hands back one opaque, deferred `run`: the aggregate list
// in `volumes.perf.ts` stays a single type without erasing what each case measures, and the
// timed call itself only fires when `volumes.perf.ts` awaits it, in the same order as before.
import { measure } from '../../../core/index.ts';
import type { Measurement, MeasureCase } from '../../../core/index.ts';

/** Settings `measure` times under; `volumes.perf.ts` passes the same ones to every case. */
interface ReglagesVolume {
  warmup?: number;
  tours?: number;
  budgetMs?: number;
}

/** One case of a single input list. */
export const un = <Entree>(name: string, input: Entree[]): MeasureCase<Entree[]>[] => [
  { name, input, size: input.length },
];

export interface CasVolume {
  run: (options: ReglagesVolume) => Promise<Measurement>;
}

export function casVolume<Entree, Sortie>(item: {
  calculation: string;
  fichier: string | string[];
  cas: MeasureCase<Entree>[];
  reference?: (list: Entree) => Sortie | Promise<Sortie>;
  optimised: (list: Entree) => Sortie | Promise<Sortie>;
  motif?: string | null;
}): CasVolume {
  return {
    run: (options) =>
      measure({
        name: item.calculation,
        fichier: item.fichier,
        cas: item.cas,
        calculation: item.optimised,
        expected: item.reference,
        motif: item.motif,
        options,
      }),
  };
}
