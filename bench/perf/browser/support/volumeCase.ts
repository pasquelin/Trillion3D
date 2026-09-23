// Batch M2's volume cases mix concrete input/output types across boxes, spheres, frustum planes
// and the normal cone. `casVolume` binds each case's `mesure` call to its own `Entree`/`Sortie`
// at the point they are concrete, and hands back one opaque, deferred `run`: the aggregate list
// in `volumes.perf.ts` stays a single type without erasing what each case measures, and the
// timed call itself only fires when `volumes.perf.ts` awaits it, in the same order as before.
import { mesure } from '../../../core/index.ts';
import type { Mesure, MesureCas } from '../../../core/index.ts';

/** Settings `mesure` times under; `volumes.perf.ts` passes the same ones to every case. */
interface ReglagesVolume {
  chauffe?: number;
  tours?: number;
  budgetMs?: number;
}

export interface CasVolume {
  run: (options: ReglagesVolume) => Promise<Mesure>;
}

export function casVolume<Entree, Sortie>(item: {
  calcul: string;
  fichier: string | string[];
  cas: MesureCas<Entree>[];
  reference?: (liste: Entree) => Sortie | Promise<Sortie>;
  optimisee: (liste: Entree) => Sortie | Promise<Sortie>;
  motif?: string | null;
}): CasVolume {
  return {
    run: (options) =>
      mesure({
        name: item.calcul,
        fichier: item.fichier,
        cas: item.cas,
        calcul: item.optimisee,
        attendu: item.reference,
        motif: item.motif,
        options,
      }),
  };
}
