// The shapes `measure.ts` measures with: statistics, result lines, cases and parameters, and the
// row with no timer, which a page's verdict also builds (`site/examples/kit/verdict.ts`).
import type { Compteur } from './ulp.ts';

export interface Stats {
  medianeMs: number;
  p95Ms: number;
  minMs: number;
  tours: number;
}

/** One measured or described row of a benchmark. */
export interface LigneResultat {
  name: string;
  size: number | null;
  medianeMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  nsParElement: number | null;
  tours: number;
  opsParSec: number | null;
  temoin: Stats | null;
  ecartTemoin: number | null;
  correct: boolean | null;
  difference: string | null;
  motif: string | null;
  /** Added by `report.ts` against the domain baseline; absent before that. */
  ecartBaseline?: number | null;
}

/** Fields of a row not fed by any timer. `null` is never zero. */
const SANS_MESURE = {
  medianeMs: null,
  p95Ms: null,
  minMs: null,
  nsParElement: null,
  tours: 0,
  opsParSec: null,
  temoin: null,
  ecartTemoin: null,
} as const;

/** A row with no timer: its name, and what verifies it. */
export const ligne = ({
  name,
  size = null,
  motif = null,
  correct = null,
  difference = null,
}: {
  name: string;
  size?: number | null;
  motif?: string | null;
  correct?: boolean | null;
  difference?: string | null;
}): LigneResultat => ({
  name,
  size,
  ...SANS_MESURE,
  correct,
  difference,
  motif,
});

/** A named benchmark's result: the file(s) it measures and its rows, one per case. */
export interface Mesure {
  name: string;
  fichier: string | string[];
  resultats: LigneResultat[];
}

/** One named input to measure, or to verify only when `mesure` is `false`. */
export interface MesureCas<Entree = unknown> {
  name: string;
  input: Entree;
  size?: number | null;
  mesure?: boolean;
}

export interface Reglages {
  chauffe: number;
  tours: number;
  budgetMs: number;
}

export interface Verdict {
  correct: boolean | null;
  difference: string | null;
  motif: string | null;
}

/** Parameters of `mesure`: the calculation, its oracle, and the settings it measures under. */
export interface MesureParams<Entree = unknown, Sortie = unknown> {
  name: string;
  fichier: string | string[];
  cas: MesureCas<Entree>[];
  options?: Partial<Reglages>;
  calcul: (input: Entree) => Sortie | Promise<Sortie>;
  attendu?: (input: Entree) => Sortie | Promise<Sortie>;
  temoin?: (input: Entree) => unknown;
  differences?: (ref: Sortie, obt: Sortie, chemin: string) => Compteur;
  motif?: string | null;
}

/** Pseudo-random generator with fixed seed (xorshift32): two executions see the same inputs. */
