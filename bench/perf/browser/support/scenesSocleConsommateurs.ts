// Inputs of consumers attached to the foundation: shadow faces, streaming queue, lighting
// transport, colours. Drawn from a seed; axis-aligned directions carry signed zeros of
// both signs, where a product started at zero and a product without an initial zero diverge.
import * as THREE from 'three';
import { graine } from '../../../core/index.ts';
import { POINT_FACE_AXES } from '../../../../packages/sdk-core/sceneLightShadowFaces.ts';
import { FULL_FACE } from '../../../../packages/sdk-core/sceneLightShadowVolume.ts';
import { BORDS, affines, matrices } from './scenesSocle.ts';
import { pageRecFixture } from './pageRecFixture.ts';
import type { PageRec } from '../../../../packages/sdk-browser/pageSelectionTypes.ts';

const alea = graine(0xc0de5);
const bord = () => BORDS[Math.floor(alea() * BORDS.length)];
const unitaire = () => {
  const v = [alea() - 0.5, alea() - 0.5, alea() - 0.5],
    n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
};

/** Directions: six point face axes, negative zero variants, and the rest. */
const avants: number[][] = [...POINT_FACE_AXES.map((a) => [...a])];
for (const a of POINT_FACE_AXES)
  for (let signes = 1; signes < 8; signes++)
    avants.push(a.map((c, k) => (c === 0 && signes & (1 << k) ? -0 : c)));
for (let i = 0; i < 200; i++) avants.push(unitaire());
for (let i = 0; i < 40; i++) avants.push([0, alea() < 0.5 ? -1 : 1, (alea() - 0.5) * 0.08]);
for (let i = 0; i < 40; i++) avants.push([bord(), bord(), bord()]);
for (let i = 0; i < 20; i++) avants.push([alea() * 9 - 4, alea() * 9 - 4, alea() * 9 - 4]);

export const directions = avants.map((before, i) => {
  const fov = [Math.PI / 2, 0.3, 1.2, 2.5, Math.PI][i % 5];
  const rect = i % 3 ? Float64Array.from([alea() - 1, alea(), alea() - 1, alea()]) : FULL_FACE;
  return {
    perspective: i % 4 !== 3,
    fov,
    portee: [10, 0.5, 1e4, 3][i % 4],
    demiEtendue: [4, 0.01, 1e3][i % 3],
    oeil: i % 9 === 0 ? [-0, 0, -0] : [alea() * 100 - 50, alea() * 100 - 50, alea() * 100 - 50],
    before,
    demiChamp: fov / 2,
    rect,
  };
});

/** Streaming queue: ordinary camera, hostile poses and matrices, spheres and boxes. */
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
camera.position.set(3, 4, 12);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const erreurs: (number | null | undefined)[] = [0, 0.5, 2, Infinity, null, undefined];
const liste: PageRec[] = [];
for (let i = 0; i < 900; i++) {
  const fini = i % 3 !== 0;
  const source = fini ? affines[i % affines.length] : matrices[i % matrices.length];
  const c = [alea() * 40 - 20, alea() * 40 - 20, alea() * 40 - 20],
    r = alea() * 3;
  const sphere = i % 7 === 0 ? undefined : [...c, r];
  liste.push(
    pageRecFixture({
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
    }),
  );
}
export const enregistrements = {
  liste,
  camera,
  echelle: [
    (1280 * camera.projectionMatrix.elements[0]) / 2,
    (720 * camera.projectionMatrix.elements[5]) / 2,
  ],
};

/** Linear values 8-bit encoding receives, including boundary values. */
export const octets: number[] = [];
for (let i = 0; i < 1024; i++) octets.push(i % 11 === 0 ? bord() : alea() * 1.2 - 0.1);

/** Transport surface rectangles: ordinary, degenerate, edge. */
const vecteur = (i: number) =>
  i % 13 === 0 ? [bord(), bord(), bord()] : [alea() * 4 - 2, alea() * 4 - 2, alea() * 4 - 2];
export const rectangles: {
  origin: number[];
  u: number[];
  v: number[];
  columns: number;
  rows: number;
}[] = [];
for (let i = 0; i < 600; i++) {
  const u = vecteur(i),
    v = i % 17 === 0 ? [...u] : vecteur(i + 1);
  rectangles.push({ origin: vecteur(i + 2), u, v, columns: 1, rows: 1 });
}

/** Transport facets: unit or edge normal, ordinary, zero or edge tangent. */
interface Facette {
  patches: { id: number; normal: number[]; u: number[]; v: number[]; center: number[] }[];
}
export const facettes: Facette[] = [];
for (let i = 0; i < 400; i++) {
  const normal = i % 9 === 0 ? [bord(), bord(), bord()] : unitaire();
  const u = i % 23 === 0 ? [0, 0, 0] : vecteur(i);
  facettes.push({ patches: [{ id: i, normal, u, v: vecteur(i + 3), center: vecteur(i + 5) }] });
}
