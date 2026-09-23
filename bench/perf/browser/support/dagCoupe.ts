// A cluster DAG for batch C: coarser and coarser levels, each replacing two clusters of the
// level below. Each cluster carries its own error and that of its replacement, so the cut
// picks exactly one per region, and a threshold twice as large picks twice as few. Everything
// comes from the shared bench's seeded generator.
import * as THREE from 'three';
import { BOX_VALUES, boxEmpty, boxExpandByPoint } from '../../../../packages/sdk-core/src/index.ts';
import { graine } from '../../../core/index.ts';
import type { ClusterRoot, PageRec } from '../../../../packages/sdk-browser/pageSelectionTypes.ts';
import type { SelectionResult } from '../../../../packages/sdk-browser/pageSelectionCutState.ts';

export type DagPage = Pick<
  PageRec,
  | 'url'
  | 'level'
  | 'triangles'
  | 'min'
  | 'max'
  | 'sphere'
  | 'lodError'
  | 'parentError'
  | 'parentSphere'
  | 'group'
  | 'source'
  | 'array'
>;

/**
 * `feuilles` clusters at level 0, half as many at each level until the unique cluster. Pages
 * are ordered from coarsest to finest, as a manifest carries them. `residentes` says what
 * share of them has its index array: the rest is missing, which the cut must see.
 */
export function dag({
  feuilles = 10000,
  seed = 61,
  residentes = 1,
  etendue = 3,
}: { feuilles?: number; seed?: number; residentes?: number; etendue?: number } = {}): DagPage[] {
  const alea = graine(seed);
  const niveaux: number[] = [];
  for (let compte = feuilles; compte >= 1; compte = compte >> 1) niveaux.push(compte);
  if (niveaux[niveaux.length - 1] !== 1) niveaux.push(1);
  const pages: DagPage[] = [];
  for (let level = niveaux.length - 1; level >= 0; level--) {
    const compte = niveaux[level],
      rayon = etendue / Math.max(1, Math.sqrt(compte)),
      erreur = 2 ** level * 0.01;
    const parent = level + 1 < niveaux.length ? 2 ** (level + 1) * 0.01 : null;
    const gridSide = Math.ceil(Math.sqrt(compte));
    for (let i = 0; i < compte; i++) {
      const cx = ((i % gridSide) / gridSide - 0.5) * etendue * 2,
        cy = (Math.floor(i / gridSide) / gridSide - 0.5) * etendue * 2,
        cz = (alea() - 0.5) * 0.5;
      pages.push({
        url: `n${level}-${i}.bin`,
        level,
        triangles: 128,
        min: [cx - rayon, cy - rayon, cz - rayon],
        max: [cx + rayon, cy + rayon, cz + rayon],
        sphere: [cx, cy, cz, rayon],
        lodError: erreur,
        parentError: parent,
        parentSphere: parent === null ? null : [cx, cy, cz, rayon * 2],
        group: null,
        source: null,
        array: alea() < residentes ? new Uint32Array(3) : undefined,
      });
    }
  }
  return pages;
}

/** A selection root without a culling hierarchy: descent takes the pages in order. */
export function racine(pages: DagPage[]): ClusterRoot<DagPage> {
  const monde = new THREE.Matrix4();
  const box = new Float64Array(BOX_VALUES);
  boxEmpty(box, 0);
  for (const page of pages) {
    boxExpandByPoint(box, 0, page.min[0], page.min[1], page.min[2]);
    boxExpandByPoint(box, 0, page.max[0], page.max[1], page.max[2]);
  }
  return { world: monde, pages, worldBox: box, localBox: box };
}

/** The visible state of a cut: displayed and requested pages in order, and its counters. */
export function etatDeCoupe(result: SelectionResult<DagPage>) {
  return {
    shown: result.shown.map((rec) => rec.url),
    wanted: result.wanted.map((rec) => rec.url),
    visible: result.visible,
    selectedTriangles: result.selectedTriangles,
    displayedTriangles: result.displayedTriangles,
    frustumRejected: result.frustumRejected,
    nodesTested: result.nodesTested,
    lodLevel: result.lodLevel,
    complete: result.complete,
    pixelError: result.pixelError,
  };
}
