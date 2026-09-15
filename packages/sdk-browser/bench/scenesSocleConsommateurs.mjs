// Les entrées des consommateurs rattachés au socle : faces d'ombre, file de streaming, transport
// d'éclairage, couleurs. Tirées à graine fixe ; les directions alignées sur les axes portent des
// zéros des deux signes, là où un produit commencé à zéro et un produit sans zéro initial divergent.
import * as THREE from 'three';
import { graine } from '../../sdk-core/bench/banc.mjs';
import { POINT_FACE_AXES } from '../../sdk-core/sceneLightShadowFaces.ts';
import { FULL_FACE } from '../../sdk-core/sceneLightShadowVolume.ts';
import { BORDS, affines, matrices } from './scenesSocle.mjs';

const alea = graine(0xc0de5);
const bord = () => BORDS[Math.floor(alea() * BORDS.length)];
const unitaire = () => {
  const v = [alea() - 0.5, alea() - 0.5, alea() - 0.5],
    n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
};

/** Directions : les six axes des faces ponctuelles, leurs variantes à zéros négatifs, et le reste. */
const avants = [...POINT_FACE_AXES.map((a) => [...a])];
for (const a of POINT_FACE_AXES)
  for (let signes = 1; signes < 8; signes++)
    avants.push(a.map((c, k) => (c === 0 && signes & (1 << k) ? -0 : c)));
for (let i = 0; i < 200; i++) avants.push(unitaire());
for (let i = 0; i < 40; i++) avants.push([0, alea() < 0.5 ? -1 : 1, (alea() - 0.5) * 0.08]);
for (let i = 0; i < 40; i++) avants.push([bord(), bord(), bord()]);
for (let i = 0; i < 20; i++) avants.push([alea() * 9 - 4, alea() * 9 - 4, alea() * 9 - 4]);

export const directions = avants.map((avant, i) => {
  const fov = [Math.PI / 2, 0.3, 1.2, 2.5, Math.PI][i % 5];
  const rect = i % 3 ? Float64Array.from([alea() - 1, alea(), alea() - 1, alea()]) : FULL_FACE;
  return {
    perspective: i % 4 !== 3,
    fov,
    portee: [10, 0.5, 1e4, 3][i % 4],
    demiEtendue: [4, 0.01, 1e3][i % 3],
    oeil: i % 9 === 0 ? [-0, 0, -0] : [alea() * 100 - 50, alea() * 100 - 50, alea() * 100 - 50],
    avant,
    demiChamp: fov / 2,
    rect,
  };
});

/** La file de streaming : caméra ordinaire, poses et matrices hostiles, sphères et boîtes. */
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
camera.position.set(3, 4, 12);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const erreurs = [0, 0.5, 2, Infinity, null, undefined];
const liste = [];
for (let i = 0; i < 900; i++) {
  const fini = i % 3 !== 0;
  const source = fini ? affines[i % affines.length] : matrices[i % matrices.length];
  const c = [alea() * 40 - 20, alea() * 40 - 20, alea() * 40 - 20],
    r = alea() * 3;
  const sphere = i % 7 === 0 ? undefined : [...c, r];
  liste.push({
    url: `c${i}`,
    streamUrl: i % 5 === 0 ? `b${i % 40}` : undefined,
    matrix: new THREE.Matrix4().fromArray(source),
    min: [c[0] - r, c[1] - r, c[2] - r],
    max: [c[0] + r, c[1] + r, c[2] + r],
    lodError: erreurs[i % erreurs.length] ?? 0,
    sphere,
    parentError: i % 4 === 0 ? null : erreurs[(i >> 1) % erreurs.length],
    parentSphere: i % 6 === 0 ? null : sphere,
    array: i % 50 === 0 ? new Uint32Array(1) : undefined,
    fini,
  });
}
export const enregistrements = {
  liste,
  camera,
  echelle: [
    (1280 * camera.projectionMatrix.elements[0]) / 2,
    (720 * camera.projectionMatrix.elements[5]) / 2,
  ],
};

/** Les valeurs linéaires que l'encodage 8 bits reçoit, bords compris. */
export const octets = [];
for (let i = 0; i < 1024; i++) octets.push(i % 11 === 0 ? bord() : alea() * 1.2 - 0.1);

/** Rectangles de surface du transport : ordinaires, dégénérés, de bords. */
const vecteur = (i) =>
  i % 13 === 0 ? [bord(), bord(), bord()] : [alea() * 4 - 2, alea() * 4 - 2, alea() * 4 - 2];
export const rectangles = [];
for (let i = 0; i < 600; i++) {
  const u = vecteur(i),
    v = i % 17 === 0 ? [...u] : vecteur(i + 1);
  rectangles.push({ origin: vecteur(i + 2), u, v, columns: 1, rows: 1 });
}

/** Facettes du transport : normale unitaire ou de bords, tangente ordinaire, nulle ou de bords. */
export const facettes = [];
for (let i = 0; i < 400; i++) {
  const normal = i % 9 === 0 ? [bord(), bord(), bord()] : unitaire();
  const u = i % 23 === 0 ? [0, 0, 0] : vecteur(i);
  facettes.push({ patches: [{ id: i, normal, u, v: vecteur(i + 3), center: vecteur(i + 5) }] });
}
