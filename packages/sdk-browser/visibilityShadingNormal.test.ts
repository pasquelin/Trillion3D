// Lot 4 : `visibilityShadingNormal.ts` réécrit sur les vecteurs plats du socle (`mathVector.ts`),
// sans la bibliothèque hôte. Oracle : `bench/oracles/normale.mjs`, le fichier d'avant recopié tel
// quel avec ses `Vector3`/`Matrix3`. Le banc `bench/normale.bench.mjs` rejoue 42 000 repères ; ce
// test en fixe une poignée en dur, dont deux qui font voir l'ordre des opérations :
//   — une pose dont la première ligne vaut (1e16, −1e16, 3), traversée par des tangentes tout à un :
//     la somme vaut 3 dans l'ordre de la référence, 4 si une addition se réassocie ;
//   — une pose dont la matrice des normales vaut exactement [[1, 1, 1], [0, 1, 0], [0, 0, 1]],
//     combinée à des normales de sommet (1e16, 1, 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shadingNormal } from './visibilityShadingNormal.ts';
import { referenceShadingNormal } from './bench/oracles/normale.mjs';
import type { VisMaterial, VisPage } from './visibilityTypes.ts';

const attribut = (valeurs: number[], taille: number) =>
  new THREE.BufferAttribute(Float32Array.from(valeurs), taille);

function materiau(overrides: Partial<VisMaterial> = {}): VisMaterial {
  return {
    baseColor: [0.8, 0.6, 0.4],
    metalness: 0.3,
    roughness: 0.4,
    lit: true,
    doubleSided: false,
    backSide: false,
    alphaTest: 0,
    normalScale: 1,
    normalScaleY: 1,
    aoIntensity: 1,
    emissive: [0, 0, 0],
    transmission: 0,
    ...overrides,
  };
}

/** Carte de normales 2×2 minimale : assez pour exercer `sampleLinear` sans allocation superflue. */
function carteNormales(): THREE.Texture {
  const data = Uint8Array.from([10, 200, 250, 255, 5, 90, 200, 255, 250, 5, 5, 255, 1, 1, 1, 255]);
  return {
    image: { data, width: 2, height: 2 },
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  } as unknown as THREE.Texture;
}

const TRI = {
  a: { x: 0, y: 0, z: 0, invW: 1, worldX: 0, worldY: 0, worldZ: 0 },
  b: { x: 0, y: 0, z: 0, invW: 1, worldX: 1, worldY: 0, worldZ: 0 },
  c: { x: 0, y: 0, z: 0, invW: 1, worldX: 0, worldY: 1, worldZ: 0 },
  triangleIndex: 0,
  i0: 0,
  i1: 1,
  i2: 2,
};
const BARY = { w0: 0.5, w1: 0.3, w2: 0.2 };
const UV: [number, number] = [0.3, 0.6];

/** Compare `shadingNormal` (optimisée) à `referenceShadingNormal` (oracle) sur le même repère,
 *  composante par composante, `Object.is` — le zéro signé et le NaN comptent comme la référence. */
function assertSameNormal(page: VisPage, mat: VisMaterial, screenFace: number, label: string) {
  const optimisee = shadingNormal(page, TRI, BARY, UV, mat, screenFace);
  const reference = referenceShadingNormal(page, TRI, BARY, UV, mat, screenFace);
  const attendu = [reference.x, reference.y, reference.z];
  for (let c = 0; c < 3; c++)
    assert.ok(
      Object.is(optimisee[c], attendu[c]),
      `${label}, composante ${c}: ${optimisee[c]} != ${attendu[c]}`,
    );
}

test('pose dont la ligne (1e16, −1e16, 3) traverse une tangente tout à un', () => {
  const matrix = new THREE.Matrix4().fromArray([
    1e16, 1, 1, 0, -1e16, 1, 1, 0, 3, 1, 1, 0, 0, 0, 0, 1,
  ]);
  const normal = attribut([0, 0, 1, 0, 0, 1, 0, 0, 1], 3);
  const tangent = attribut([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4);
  const uv = attribut([0, 0, 1, 0, 0, 1], 2);
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, tangent, uv },
    matrix,
  } as unknown as VisPage;
  const mat = materiau({ normalMap: carteNormales() });
  for (const screenFace of [1, -1])
    assertSameNormal(page, mat, screenFace, `1e16/-1e16/3, screenFace ${screenFace}`);
});

test('pose dont la matrice des normales vaut [[1,1,1],[0,1,0],[0,0,1]], normales (1e16,1,1)', () => {
  // Bloc 3×3 tel que transposée(inverse(bloc)) === [[1,1,1],[0,1,0],[0,0,1]] : vérifié directement
  // contre `normalMatrix3` avant d'écrire ce test.
  const matrix = new THREE.Matrix4().fromArray([
    1, -1, -1, 0, -0, 1, -0, 0, 0, -0, 1, 0, 5, -3, 2, 1,
  ]);
  const normal = attribut([1e16, 1, 1, 1e16, 1, 1, 1e16, 1, 1], 3);
  const uv = attribut([0, 0, 1, 0, 0, 1], 2);
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, uv },
    matrix,
  } as unknown as VisPage;
  for (const doubleSided of [false, true])
    for (const withMap of [false, true]) {
      const mat = materiau({ doubleSided, normalMap: withMap ? carteNormales() : undefined });
      for (const screenFace of [1, -1])
        assertSameNormal(page, mat, screenFace, `ds${doubleSided} map${withMap} sf${screenFace}`);
    }
});

test('échelle négative et cisaillement, sans normale de sommet ni carte : la normale géométrique seule', () => {
  const matrix = new THREE.Matrix4().fromArray([
    2, 0.5, 0, 0, 0, -3, 0, 0, 0.25, 0, 0.5, 0, 1, 2, 3, 1,
  ]);
  const uv = attribut([0, 0, 1, 0, 0, 1], 2);
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { uv },
    matrix,
  } as unknown as VisPage;
  for (const backSide of [false, true])
    for (const screenFace of [1, -1])
      assertSameNormal(page, materiau({ backSide }), screenFace, `bs${backSide} sf${screenFace}`);
});

// perf(socle) 61bff6e4 : les trois composantes de la carte de normales (`mapN`) ne passent plus par
// un tableau littéral, alloué à chaque pixel ombré d'une surface qui porte une carte. `shadingNormal`
// rend toujours `frameOut`, le même tampon de module (documenté en tête de fichier : « aucune
// allocation, [...] rendu dans l'un d'eux ») ; le vérifier sur de nombreux appels enchaînés, chacun
// avec une carte de normales et des repères différents, est la même méthode que le test
// « allocation » de `mathTransformTreeUpdate.test.ts` : l'identité du tampon rendu, et non un compte
// d'allocations, atteste qu'aucun tampon n'est fabriqué en cours de route.
test('surface à carte de normales : mille pixels ombrés de suite rendent toujours le même tampon', () => {
  const matrix = new THREE.Matrix4().fromArray([
    1, 0.2, 0, 0, -0.1, 1, 0.3, 0, 0, -0.2, 1, 0, 1, 2, 3, 1,
  ]);
  const normal = attribut([0, 0, 1, 0.1, 0, 1, 0, 0.1, 1], 3);
  const tangent = attribut([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1], 4);
  const uv = attribut([0, 0, 1, 0, 0, 1], 2);
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, tangent, uv },
    matrix,
  } as unknown as VisPage;
  const mat = materiau({ normalMap: carteNormales(), normalScale: 1.3, normalScaleY: 0.7 });
  let premierTampon: Float64Array | undefined;
  for (let i = 0; i < 1000; i++) {
    const bary = { w0: (i % 7) / 7, w1: ((i + 1) % 5) / 5, w2: ((i + 2) % 3) / 3 };
    const uvPixel: [number, number] = [(i % 11) / 11, (i % 13) / 13];
    const rendu = shadingNormal(page, TRI, bary, uvPixel, mat, i % 2 === 0 ? 1 : -1);
    if (i === 0) premierTampon = rendu;
    assert.equal(rendu, premierTampon, `pixel ${i} : un nouveau tampon a été fabriqué`);
  }
});

test('NaN et infinis dans les poids barycentriques et les tangentes, carte sans normale de sommet', () => {
  const matrix = new THREE.Matrix4();
  const uv = attribut([0, 0, 1, 0, 0.5, 1], 2);
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { uv },
    matrix,
  } as unknown as VisPage;
  const mat = materiau({ normalMap: carteNormales() });
  const baryHostile = { w0: NaN, w1: Infinity, w2: -Infinity };
  const optimisee = shadingNormal(page, TRI, baryHostile, UV, mat, 1);
  const reference = referenceShadingNormal(page, TRI, baryHostile, UV, mat, 1);
  const attendu = [reference.x, reference.y, reference.z];
  for (let c = 0; c < 3; c++)
    assert.ok(Object.is(optimisee[c], attendu[c]), `bary hostile, composante ${c}`);
});
