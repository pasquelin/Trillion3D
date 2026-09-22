/** Why a DAG group stalled, named by the compiler by rerunning the stalled reduction with a
 *  constraint lifted: `too-small` (fewer than two live triangles), `border-locked` (with no lock
 *  it advances), `seam-locked` (with no lock it still stalls, with position copies also welded
 *  across every texture seam it advances), `unreducible` (neither advances), `border-lost` (a
 *  shared position disappeared on every retry), `unusable-error`. */
export type DagStallCause =
  'too-small' | 'seam-locked' | 'border-locked' | 'unreducible' | 'border-lost' | 'unusable-error';
/** What the stalls of a primitive come to: the level-0 triangles left as roots, the cause of
 *  the stalls holding the most triangles (`null` without a stall), and the seam, locked and
 *  texture-island counts summed over its stalled groups. */
export interface DagStallSummary {
  rootTriangles: number;
  cause: DagStallCause | null;
  seamVertices: number;
  lockedVertices: number;
  uvIslands: number;
}
/** One stalled group: the level it was built for, its cause, its live triangles, its positions
 *  used under several texture coordinates, those shared with another group, and its connected
 *  texture islands. */
export interface DagStall {
  level: number;
  cause: DagStallCause;
  triangles: number;
  seamVertices: number;
  lockedVertices: number;
  uvIslands: number;
}
/** A DAG that the compiler did not coarsen: the coarsest level is what renders in the distance;
 *  a primitive without a single root renders finely at any distance. `DAG_FLAT` has no coarse levels;
 *  `DAG_ROOTS` retains more than one root per 8 pages; `groups` counts groups by outcome, and the
 *  stall summary says why. */
export interface DagWarning extends DagStallSummary {
  code: 'DAG_FLAT' | 'DAG_ROOTS';
  roots: number;
  pages: number;
  groups: Record<string, number>;
}
/** DAG report for a primitive; only its warnings are consumed by the runtime engine. A report
 *  listing its stalls carries their summary. */
export type DagReport = { warnings?: DagWarning[] } & (
  { stalls?: undefined } | ({ stalls: DagStall[] } & DagStallSummary)
);
