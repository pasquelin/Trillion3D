// Charges du banc de performance des volumes (lot M2), réalistes pour le moteur : boîtes de pages
// placées par une soixantaine de matrices monde de racines (rotation, translation, échelles de 0,5 à
// 2 dont une sur quatre miroir), vue-projection perspective en profondeur WebGPU. Même travail des
// deux côtés : Three.js sur ses objets `Box3`, `Sphere`, `Frustum`, sdk-core sur des tableaux à plat.
// Chaque ligne sait vérifier que les deux côtés ont rendu les mêmes bits.
import * as THREE from 'three';
import {
  FRUSTUM_PLANE_VALUES,
  boxTransform,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  sphereFromBounds,
} from '../../sdk-core/index.ts';
import { graine } from '../../sdk-core/bench/banc.mjs';

const alea = graine(70919);
const dans = (etendue) => (alea() * 2 - 1) * etendue;
/** Au moins cent mille opérations par répétition : une durée lisible même pour un lot de mille. */
const OPERATIONS_MIN = 100_000;

const mondes = Array.from({ length: 64 }, (_, i) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(dans(300), dans(20), dans(300)),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(dans(Math.PI), dans(Math.PI), dans(Math.PI)),
    ),
    new THREE.Vector3((i % 4 ? 1 : -1) * (0.5 + alea() * 1.5), 0.5 + alea() * 1.5, 0.5 + alea()),
  ),
);
const elements = mondes.map((m) => m.elements);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
camera.updateProjectionMatrix();
camera.position.set(0, 40, 250);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const vueProjection = new THREE.Matrix4().multiplyMatrices(
  camera.projectionMatrix,
  camera.matrixWorldInverse,
);

const memes = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const aPlat = (boites, champ) =>
  boites.flatMap((b) =>
    champ ? [...b.center.toArray(), b.radius] : [...b.min.toArray(), ...b.max.toArray()],
  );

/** `n` boîtes locales et leurs images monde, dans les deux représentations. */
function charge(n) {
  const boites = [],
    boitesMonde = [];
  for (let i = 0; i < n; i++) {
    const c = new THREE.Vector3(dans(40), dans(40), dans(40)),
      e = new THREE.Vector3(0.05 + alea() * 4, 0.05 + alea() * 4, 0.05 + alea() * 4);
    const boite = new THREE.Box3(c.clone().sub(e), c.clone().add(e));
    boites.push(boite);
    boitesMonde.push(boite.clone().applyMatrix4(mondes[i & 63]));
  }
  return {
    boites,
    boitesMonde,
    plat: Float64Array.from(aPlat(boites)),
    monde: Float64Array.from(aPlat(boitesMonde)),
    sortieBoites: boites.map(() => new THREE.Box3()),
    sortiePlat: new Float64Array(n * 6),
    spheres: boites.map(() => new THREE.Sphere()),
    spheresPlat: new Float64Array(n * 4),
    verdictsThree: new Uint8Array(n),
    verdictsNous: new Uint8Array(n),
    tronc: new THREE.Frustum(),
    plans: new Float64Array(FRUSTUM_PLANE_VALUES),
  };
}

/** Une ligne : le corps de chaque côté parcourt `n` éléments, répété jusqu'au minimum d'opérations. */
function ligne(famille, nom, n, c, three, nous, verifie) {
  const tours = Math.max(1, Math.ceil(OPERATIONS_MIN / n));
  return {
    famille,
    nom,
    taille: n,
    operations: tours * n,
    three: () => {
      for (let t = 0; t < tours; t++) three(c, n);
      return c;
    },
    nous: () => {
      for (let t = 0; t < tours; t++) nous(c, n);
      return c;
    },
    verifie: () => (verifie(c) ? null : 'les deux côtés ne rendent pas les mêmes bits'),
  };
}

const transformeThree = (c, n) => {
  for (let i = 0; i < n; i++) c.sortieBoites[i].copy(c.boites[i]).applyMatrix4(mondes[i & 63]);
};
const transformeNous = (c, n) => {
  for (let i = 0; i < n; i++) boxTransform(c.sortiePlat, i * 6, c.plat, i * 6, elements[i & 63]);
};
const transformeVerifie = (c) => memes(aPlat(c.sortieBoites), c.sortiePlat);

const sphereThree = (c, n) => {
  for (let i = 0; i < n; i++) c.boites[i].getBoundingSphere(c.spheres[i]);
};
const sphereNous = (c, n) => {
  const b = c.plat;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    sphereFromBounds(c.spheresPlat, i * 4, b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5]);
  }
};
const sphereVerifie = (c) => memes(aPlat(c.spheres, true), c.spheresPlat);

const plansThree = (c) =>
  c.tronc.setFromProjectionMatrix(vueProjection, THREE.WebGPUCoordinateSystem);
const plansNous = (c) => frustumPlanesFromMatrix(c.plans, vueProjection.elements, true);
const testeThree = (c, n) => {
  for (let i = 0; i < n; i++) c.verdictsThree[i] = c.tronc.intersectsBox(c.boitesMonde[i]) ? 1 : 0;
};
const testeNous = (c, n) => {
  const b = c.monde,
    p = c.plans;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    c.verdictsNous[i] = frustumExcludesBox(
      p,
      b[o],
      b[o + 1],
      b[o + 2],
      b[o + 3],
      b[o + 4],
      b[o + 5],
    )
      ? 0
      : 1;
  }
};
const testeVerifie = (c) => memes([...c.verdictsThree], [...c.verdictsNous]);
const plansVerifie = (c) => {
  const trois = c.tronc.planes.flatMap((p) => [...p.normal.toArray(), p.constant]);
  return memes(trois, c.plans) && testeVerifie(c);
};

/** Les lignes de la campagne : opération seule, lots, puis l'image — plans une fois, tous les tests. */
export function lignesDePerformance() {
  const seule = charge(1);
  plansThree(seule);
  plansNous(seule);
  const lignes = [
    ligne(
      'seule',
      'transformation de boîte',
      1,
      seule,
      transformeThree,
      transformeNous,
      transformeVerifie,
    ),
    ligne('seule', 'sphère depuis boîte', 1, seule, sphereThree, sphereNous, sphereVerifie),
    ligne('seule', 'plans du tronc', 1, seule, plansThree, plansNous, plansVerifie),
    ligne('seule', 'test boîte/tronc', 1, seule, testeThree, testeNous, testeVerifie),
  ];
  for (const n of [1_000, 10_000, 100_000]) {
    const c = charge(n);
    plansThree(c);
    plansNous(c);
    lignes.push(
      ligne(
        'lot',
        'transformation de boîtes',
        n,
        c,
        transformeThree,
        transformeNous,
        transformeVerifie,
      ),
      ligne('lot', 'sphères depuis boîtes', n, c, sphereThree, sphereNous, sphereVerifie),
      ligne('lot', 'tests boîte/tronc', n, c, testeThree, testeNous, testeVerifie),
      ligne(
        'image',
        'plans une fois puis tous les tests',
        n,
        c,
        (k, m) => {
          plansThree(k);
          testeThree(k, m);
        },
        (k, m) => {
          plansNous(k);
          testeNous(k, m);
        },
        plansVerifie,
      ),
    );
  }
  return lignes;
}
