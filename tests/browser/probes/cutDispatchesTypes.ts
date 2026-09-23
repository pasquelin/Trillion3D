// Result shape of the dispatch-count measurement (`cutDispatchesPage.ts`), read by the bench
// (`cut-dispatches-gpu.ts`). Split apart so both files hold `check:lines`.

/** Input of the page's `executer`: the scene and the sweeps it measures. */
export interface ExecuterParams {
  feuilles: number;
  niveaux: number;
  profondeurs: number[];
  tours: number;
  rondes: number;
  bornes: number[];
}

/** What one readback of the selection output carries: kept and drawn pages, bit for bit. */
export interface Releve {
  pages: number[];
  dessinees: number[];
  frustumRejected: number;
  overflow: number;
}

/** All-optional: the page's own `executer` returns one of several shapes (no adapter, a
 *  compile failure, or the full measurement), flattened so the bench can read any field. */
export interface ExecuterResultat {
  indisponible?: string;
  compilation?: string[];
  erreurs?: string[];
  adaptateur?: string;
  pages?: number;
  noeuds?: number;
  profondeurLivree?: number;
  profondeurs?: number[];
  etagesLivres?: number[];
  noms?: string[];
  comptes?: Array<Array<{ passes: number; copies: number }>>;
  mesures?: Array<Array<Array<{ encodage: number; total: number }>>>;
  sorties?: Array<{ nom: string } & Releve>;
  balayage?: Array<{ borneParNiveau: number; ms: number; sortie: Releve }>;
}
