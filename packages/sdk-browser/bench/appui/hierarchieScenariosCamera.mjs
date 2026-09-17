// Scénarios de caméra du lot M3a : `lookAt` et projections, cas limites compris, rejoués des deux côtés.
import { alea, dans } from './hierarchieScenarios.mjs';

const HAUTS = [
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [0, -1, 0],
];
const PARENTS = [
  null,
  [
    [4, -2, 7],
    [0.2, 0.5, -0.1, 0.84],
    [1, 1, 1],
  ],
  [
    [-3, 1, 2],
    [0, 0.6, 0, 0.8],
    [-1, 1, 1],
  ],
  [
    [0, 5, 0],
    [0.3, -0.2, 0.4, 0.84],
    [-2, -0.5, -3],
  ],
  [
    [1, 1, 1],
    [0.5, 0.5, 0.5, 0.5],
    [3, 0.25, 1],
  ],
  [
    [2, 0, -2],
    [0, 0, 0, 1],
    [0, 1, 1],
  ],
];
const cameraFixe = {
  fov: 60,
  aspect: 16 / 9,
  near: 0.1,
  far: 1000,
  zoom: 1,
  webgpu: false,
};
const origine = [
  [0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 1],
];

/**
 * `lookAt` d'une caméra et d'un objet, racines ou enfants d'un parent tourné, miroir sur un ou trois
 * axes, non uniforme ou d'échelle nulle ; cibles ordinaires, sur l'œil, NaN, infinie ; haut
 * colinéaire à la visée. Après chaque visée : mise à jour, lectures, image de la caméra.
 */
export function visees() {
  const ops = [];
  let id = 0;
  for (const parent of PARENTS) {
    const racine = parent ? id++ : -1;
    if (parent) ops.push(['ajoute', racine, -1, ...parent, null]);
    const camera = id++,
      objet = id++;
    ops.push([
      'ajoute',
      camera,
      racine,
      [dans(10), dans(10), dans(10)],
      ...origine.slice(1),
      cameraFixe,
    ]);
    ops.push(['ajoute', objet, racine, [dans(10), dans(10), dans(10)], ...origine.slice(1), null]);
    const surOeil = id++;
    ops.push(['ajoute', surOeil, racine, ...origine, { ...cameraFixe, webgpu: true }]);
    const pointParent = parent ? parent[0] : [0, 0, 0];
    const cibles = [
      [0, 0, 0],
      [dans(30), dans(30), dans(30)],
      pointParent,
      [NaN, 0, 0],
      [Infinity, 0, 0],
    ];
    for (const cible of cibles)
      for (const haut of HAUTS)
        for (const vise of [camera, objet, surOeil]) {
          ops.push(
            ['vise', vise, cible, haut],
            ['maj', parent ? racine : vise, false],
            ['lis', vise],
          );
          if (vise !== objet) ops.push(['image', vise, vise === surOeil]);
        }
  }
  // Haut colinéaire à la visée : au-dessus de l'origine avec le haut `y`, devant elle avec `±z`.
  const dessus = id,
    devant = id + 1;
  ops.push(['ajoute', dessus, -1, [0, 10, 0], ...origine.slice(1), cameraFixe]);
  ops.push(['ajoute', devant, -1, [0, 0, 10], ...origine.slice(1), cameraFixe]);
  for (const [vise, haut] of [
    [dessus, [0, 1, 0]],
    [dessus, [0, -1, 0]],
    [devant, [0, 0, 1]],
    [devant, [0, 0, -1]],
  ])
    ops.push(
      ['vise', vise, [0, 0, 0], haut],
      ['maj', vise, false],
      ['lis', vise],
      ['image', vise, true],
    );
  return ops;
}

/**
 * Projections : champ, rapport, plans et grossissement ordinaires et dégénérés (champ nul ou plat,
 * `near` nul, `far` égal à `near` ou infini, zoom nul), chaque réglage dans les deux conventions de
 * profondeur, plans lus dans les deux conventions.
 */
export function objectifs() {
  const ops = [['ajoute', 0, -1, [1, 2, 3], [0.1, 0.2, 0.3, 0.927], [1, 1, 1], cameraFixe]];
  const image = (spec) => ops.push(['objectif', 0, spec], ['image', 0, false], ['image', 0, true]);
  for (const webgpu of [false, true])
    for (const fov of [1e-6, 45, 90, 179.999, 180, 0, NaN])
      for (const aspect of [1e-9, 1, 16 / 9, 1e9])
        for (const [near, far] of [
          [1e-6, 1e9],
          [0.1, 0.1],
          [0, 100],
          [0.5, Infinity],
          [10, 1],
        ])
          for (const zoom of [1, 2.5, 0]) image({ fov, aspect, near, far, zoom, webgpu });
  for (let i = 0; i < 64; i++)
    image({
      fov: 10 + alea() * 160,
      aspect: 0.2 + alea() * 4,
      near: alea() * 2,
      far: 2 + alea() * 1e5,
      zoom: 0.1 + alea() * 4,
      webgpu: alea() < 0.5,
    });
  return ops;
}
