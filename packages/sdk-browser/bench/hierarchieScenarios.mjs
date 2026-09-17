// Scénarios d'équivalence de la hiérarchie (lot M3a), rejoués des deux côtés par
// `hierarchieRejeuThree.mjs` et `hierarchieRejeuNous.mjs`.
// Tirés d'une graine fixe : deux exécutions jouent exactement les mêmes opérations.
import { graine } from '../../sdk-core/bench/mesure.mjs';

const alea = graine(0x3a3a);
const tire = (liste) => liste[Math.floor(alea() * liste.length)];
const dans = (etendue) => (alea() * 2 - 1) * etendue;
const tourne = () => {
  const q = [alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5];
  const l = Math.hypot(...q);
  return q.map((c) => c / l);
};

/** Positions, rotations et échelles hostiles : ±0, extrêmes, NaN, infinis, miroirs, nulles. */
const POSITIONS = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [1e150, -1e150, 1e-300],
  [NaN, 0, 1],
  [Infinity, -Infinity, 0],
];
const ROTATIONS = [
  [0, 0, 0, 1],
  [-0, -0, -0, -1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  [1e-9, 0, 0, 1],
  [1, 2, 3, 4],
  [NaN, 0, 0, 1],
];
const ECHELLES = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, -1],
  [-1, -1, -1],
  [2, 0.5, 3],
  [-2, 3, 0.25],
  [0, 1, 1],
  [0, 0, 0],
  [-0, 1, 1],
  [1e-300, 1, 1],
  [1e150, 1e150, 1e150],
  [Infinity, 1, 1],
  [NaN, 1, 1],
];

/** Une pose ordinaire : ce que porte une scène réelle, échelles de 0,5 à 2 dont une sur quatre miroir. */
const ordinaire = () => [
  [dans(50), dans(50), dans(50)],
  tourne(),
  [(alea() < 0.25 ? -1 : 1) * (0.5 + alea() * 1.5), 0.5 + alea() * 1.5, 0.5 + alea() * 1.5],
];
/** Une pose hostile une fois sur `rarete`, ordinaire sinon. */
const pose = (rarete) =>
  alea() * rarete < 1 ? [tire(POSITIONS), tire(ROTATIONS), tire(ECHELLES)] : ordinaire();

export const cameraAuHasard = () => ({
  fov: 20 + alea() * 100,
  aspect: 0.5 + alea() * 2,
  near: 0.01 + alea(),
  far: 100 + alea() * 1000,
  zoom: alea() < 0.5 ? 1 : 0.5 + alea() * 3,
  webgpu: alea() < 0.5,
});

/** Descendants vivants de `id`, lui compris, d'après les parents tenus par le générateur. */
export function sousArbre(parents, vivants, id) {
  const pris = new Set([id]);
  for (let change = true; change;) {
    change = false;
    parents.forEach((p, n) => {
      if (!vivants[n] || pris.has(n) || !pris.has(p)) return;
      pris.add(n);
      change = true;
    });
  }
  return [...pris];
}

const finies = (liste) => liste.filter((v) => v.every(Number.isFinite));

/**
 * Chaînes figées : profondeurs 1 à 6 sous des racines, branches à cinq enfants portant chacun trois
 * niveaux, une caméra sous une chaîne sur cinq, échelle et rotation
 * hostiles à chaque niveau. Puis mise à jour forcée, instantané, lectures de chaque nœud et images
 * de chaque caméra dans les deux conventions de plans. `nonFinies` faux écarte NaN et infinis, qui
 * gagneraient tout le sous-arbre et cacheraient un écart derrière un NaN partagé.
 */
export function chainesFigees(nonFinies) {
  const positions = nonFinies ? POSITIONS : finies(POSITIONS),
    rotations = nonFinies ? ROTATIONS : finies(ROTATIONS),
    echelles = nonFinies ? ECHELLES : finies(ECHELLES);
  const ops = [],
    racines = [],
    cameras = [];
  let id = 0;
  const ajoute = (parent, k, niveau, camera = null) => {
    ops.push([
      'ajoute',
      id,
      parent,
      positions[(k + niveau) % positions.length],
      rotations[(k * 3 + niveau) % rotations.length],
      echelles[(k * 7 + niveau * 5) % echelles.length],
      camera,
    ]);
    if (parent < 0) racines.push(id);
    if (camera) cameras.push(id);
    return id++;
  };
  for (let k = 0; k < 48; k++) {
    let parent = -1;
    for (let niveau = 0; niveau <= k % 6; niveau++) parent = ajoute(parent, k, niveau);
    if (k % 5 === 0) ajoute(parent, k, 7, cameraAuHasard());
  }
  for (let k = 0; k < 8; k++) {
    const branche = ajoute(-1, k, 0);
    for (let enfant = 0; enfant < 5; enfant++) {
      let parent = branche;
      for (let niveau = 1; niveau <= 3; niveau++) parent = ajoute(parent, k + enfant, niveau);
    }
  }
  for (const r of racines) ops.push(['maj', r, true]);
  ops.push(['instantane', 0]);
  for (let n = 0; n < id; n++) ops.push(['lis', n]);
  for (const c of cameras) ops.push(['image', c, false], ['image', c, true]);
  return ops;
}

export { alea, dans, pose, tire };
