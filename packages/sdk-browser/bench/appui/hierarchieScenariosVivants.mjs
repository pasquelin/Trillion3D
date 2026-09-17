// Scénario vivant de la hiérarchie (lot M3a) : une scène qui bouge image après image, avec tout ce que
// la règle de mise à jour de la référence rend délicat — poses partielles, matrices locales posées à la
// main avec ou sans mise à jour automatique, reparentage et détachement (un sous-arbre détaché garde
// des matrices en retard), retraits et ajouts, `updateWorldMatrix` sur un nœud quelconque, `lookAt`,
// lectures et images au milieu. Chaque image finit par une mise à jour de la racine et un instantané
// de tous les nœuds vivants : les matrices en retard doivent l'être des deux côtés, identiquement.
import { alea, cameraAuHasard, dans, pose, sousArbre, tire } from './hierarchieScenarios.mjs';

const HAUTS = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0],
  [0, -1, 0],
];

/** Une matrice locale posée à la main : une pose composée à la louche, parfois cisaillée. */
const matriceAuHasard = () => Array.from({ length: 16 }, (_, i) => (i === 15 ? 1 : dans(4)));

/**
 * `taille` nœuds sous la racine 0 (jamais retirée ni déplacée), `images` images de une à huit actions,
 * une pose hostile sur `rareteHostile` en moyenne.
 */
export function scenarioVivant(taille, images, rareteHostile) {
  const ops = [],
    parents = [],
    vivants = [],
    cameras = new Set();
  let prochain = 0;
  const ajoute = (parent) => {
    const id = prochain++;
    const camera = alea() < 0.08 ? cameraAuHasard() : null;
    ops.push(['ajoute', id, parent, ...pose(rareteHostile), camera]);
    parents[id] = parent;
    vivants[id] = true;
    if (camera) cameras.add(id);
    return id;
  };
  const vivant = (horsRacine) => {
    if (horsRacine && !vivants.some((v, id) => v && id)) ajoute(0);
    for (;;) {
      const id = Math.floor(alea() * prochain);
      if (vivants[id] && !(horsRacine && id === 0)) return id;
    }
  };
  ajoute(-1);
  for (let n = 1; n < taille; n++) ajoute(vivant(false));
  ops.push(['maj', 0, true]);
  for (let image = 0; image < images; image++) {
    const actions = 1 + Math.floor(alea() * 8);
    for (let a = 0; a < actions; a++) {
      const r = alea();
      if (r < 0.3) {
        const [p, q, s] = pose(rareteHostile);
        ops.push([
          'pose',
          vivant(false),
          alea() < 0.8 ? p : null,
          alea() < 0.6 ? q : null,
          alea() < 0.5 ? s : null,
        ]);
      } else if (r < 0.38) ops.push(['local', vivant(false), matriceAuHasard()]);
      else if (r < 0.45) ops.push(['auto', vivant(false), alea() < 0.6]);
      else if (r < 0.52) {
        const id = vivant(true);
        let parent = alea() < 0.15 ? -1 : vivant(false);
        if (parent >= 0 && sousArbre(parents, vivants, id).includes(parent)) parent = -1;
        ops.push(['rattache', id, parent]);
        parents[id] = parent;
      } else if (r < 0.56) {
        const id = vivant(true),
          retires = sousArbre(parents, vivants, id);
        ops.push(['retire', id, retires]);
        for (const n of retires) {
          vivants[n] = false;
          cameras.delete(n);
        }
      } else if (r < 0.62) ajoute(vivant(false));
      else if (r < 0.72) ops.push(['majMonde', vivant(false), alea() < 0.5, alea() < 0.5]);
      else if (r < 0.8)
        ops.push(['vise', vivant(false), [dans(60), dans(60), dans(60)], tire(HAUTS)]);
      else if (r < 0.88) ops.push(['lis', vivant(false)]);
      else if (r < 0.94 && cameras.size) ops.push(['image', tire([...cameras]), alea() < 0.5]);
      else ops.push(['maj', vivant(false), alea() < 0.3]);
    }
    ops.push(['maj', 0, alea() < 0.2], ['instantane', 0]);
  }
  return ops;
}

const M1 = [0.8, 0.1, -0.5, 0, -0.2, 1.5, 0.3, 0, 0.4, -0.6, 0.9, 0, 3, -7, 2, 1],
  M2 = [-1, 0, 0, 0, 0, 2, 0.5, 0, 0, -0.25, 1, 0, -4, 1, 9, 1];
const racine = (id, parent = -1) => [
  'ajoute',
  id,
  parent,
  [1, -2, 3],
  [0.1, 0.7, -0.1, 0.7],
  [2, 1, -1],
  null,
];

/**
 * Les règles de marquage de la référence, jouées exprès plutôt qu'attendues du hasard : marque
 * `matrixWorldNeedsUpdate` posée par `updateWorldMatrix` puis effacée par `updateMatrixWorld`, matrice
 * monde en retard sous un parent sans mise à jour automatique puis rattrapée par `force`, sous-arbre
 * détaché, rattachement sous un nœud d'indice supérieur, retrait puis réemploi des indices.
 */
export function marquages() {
  return [
    racine(0),
    racine(1, 0),
    racine(2, 1),
    ['maj', 0, true],
    ['majMonde', 2, false, false],
    ['auto', 2, false],
    ['maj', 0, false],
    ['auto', 1, false],
    ['local', 1, M1],
    ['majMonde', 1, false, false],
    ['maj', 2, false],
    ['instantane', 0],
    racine(3),
    racine(4, 3),
    ['maj', 3, true],
    ['majMonde', 4, false, false],
    ['auto', 4, false],
    ['auto', 3, false],
    ['local', 3, M2],
    ['majMonde', 3, false, false],
    ['maj', 4, false],
    ['instantane', 0],
    ['local', 4, M1],
    ['maj', 3, false],
    ['instantane', 0],
    ['maj', 3, true],
    ['instantane', 0],
    ['rattache', 4, -1],
    ['pose', 3, [5, 5, 5], null, null],
    ['auto', 3, true],
    ['maj', 3, false],
    ['maj', 4, false],
    ['instantane', 0],
    ['auto', 4, true],
    ['maj', 4, false],
    ['instantane', 0],
    racine(5),
    racine(6),
    ['rattache', 5, 6],
    ['pose', 6, null, [0, 0, 0.6, 0.8], [1, -3, 1]],
    ['maj', 6, false],
    racine(7, 5),
    ['majMonde', 7, true, false],
    ['lis', 7],
    ['retire', 6, [6, 5, 7]],
    racine(8, 0),
    racine(9, 8),
    ['rattache', 0, 3],
    ['maj', 3, true],
    ['instantane', 0],
  ];
}
