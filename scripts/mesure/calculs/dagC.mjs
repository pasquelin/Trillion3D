// Un DAG de clusters pour le lot C : des niveaux de plus en plus grossiers, chacun remplaçant deux
// clusters du niveau au-dessous. Chaque cluster porte son erreur propre et celle de son remplaçant,
// donc la coupe en choisit exactement un par région, et un seuil deux fois plus grand en choisit
// deux fois moins. Tout vient du générateur à graine fixe du banc commun.
import * as THREE from 'three';
import { graine } from './banc.mjs';

/**
 * `feuilles` clusters au niveau 0, moitié moins à chaque niveau jusqu'au cluster unique. Les pages
 * sont rangées du plus grossier au plus fin, comme les porte un manifeste. `residentes` dit quelle
 * part d'entre elles a son tableau d'indices : le reste manque, ce que la coupe doit voir.
 */
export function dag({ feuilles = 10000, seed = 61, residentes = 1, etendue = 3 } = {}) {
  const alea = graine(seed);
  const niveaux = [];
  for (let compte = feuilles; compte >= 1; compte = compte >> 1) niveaux.push(compte);
  if (niveaux[niveaux.length - 1] !== 1) niveaux.push(1);
  const pages = [];
  for (let level = niveaux.length - 1; level >= 0; level--) {
    const compte = niveaux[level],
      rayon = etendue / Math.max(1, Math.sqrt(compte)),
      erreur = 2 ** level * 0.01;
    const parent = level + 1 < niveaux.length ? 2 ** (level + 1) * 0.01 : null;
    const cote = Math.ceil(Math.sqrt(compte));
    for (let i = 0; i < compte; i++) {
      const cx = ((i % cote) / cote - 0.5) * etendue * 2,
        cy = (Math.floor(i / cote) / cote - 0.5) * etendue * 2,
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

/** Une racine de sélection sans hiérarchie de culling : la descente prend les pages dans l'ordre. */
export function racine(pages) {
  const monde = new THREE.Matrix4();
  const box = new THREE.Box3();
  for (const page of pages)
    box
      .expandByPoint(new THREE.Vector3(page.min[0], page.min[1], page.min[2]))
      .expandByPoint(new THREE.Vector3(page.max[0], page.max[1], page.max[2]));
  return { world: monde, pages, worldBox: box, localBox: box };
}

/** L'état visible d'une coupe : les pages affichées et demandées dans l'ordre, et ses compteurs. */
export function etatDeCoupe(result) {
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
