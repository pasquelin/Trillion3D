/** A DAG that the compiler did not coarsen: the coarsest level is what renders in the distance;
 *  a primitive without a single root renders finely at any distance. `DAG_FLAT` has no coarse levels;
 *  `DAG_ROOTS` retains more than one root per 8 pages; `groups` counts groups by outcome. */
export interface DagWarning {
  code: 'DAG_FLAT' | 'DAG_ROOTS';
  roots: number;
  pages: number;
  groups: Record<string, number>;
}
/** DAG report for a primitive; only its warnings are consumed by the runtime engine. */
export interface DagReport {
  warnings?: DagWarning[];
}
