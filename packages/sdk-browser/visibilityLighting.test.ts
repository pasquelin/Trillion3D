// G3 : visibilityLighting.ts hisse les constantes de l'éclairage hémisphérique (direction du
// soleil, sa longueur, la couleur du sol et du ciel) hors de `shadeLit`, appelée par pixel, au lieu
// de les recalculer et réallouer à chaque appel. Oracle : la version d'avant le lot G, recopiée
// telle quelle dans `bench/oracles/g-ombrage.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shadeLit } from './visibilityLighting.ts';
import { referenceShadeLit } from './bench/oracles/g-ombrage.mjs';
import type { VisPage, VisMaterial } from './visibilityTypes.ts';
import type { Projected } from './visibilityProjection.ts';

function vertex(worldX: number, worldY: number, worldZ: number, invW = 1): Projected {
  return { x: 0, y: 0, z: 0, invW, worldX, worldY, worldZ };
}

function fakeTexture(pixel: [number, number, number, number]): THREE.Texture {
  return {
    image: { data: Uint8Array.from(pixel), width: 1, height: 1 },
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  } as unknown as THREE.Texture;
}

function material(overrides: Partial<VisMaterial> = {}): VisMaterial {
  return {
    baseColor: [1, 1, 1],
    metalness: 0,
    roughness: 1,
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

function pageOf(overrides: Partial<VisPage> = {}): VisPage {
  return {
    array: new Uint32Array([0, 1, 2]),
    attributes: {},
    matrix: new THREE.Matrix4(),
    material: new THREE.MeshBasicMaterial(),
    ...overrides,
  };
}

const TRI_BASE = {
  a: vertex(-1, -1, 0, 1),
  b: vertex(1, -1.2, 0.3, 1.1),
  c: vertex(0.2, 1, -0.4, 0.9),
  triangleIndex: 0,
  i0: 0,
  i1: 1,
  i2: 2,
};
const CAMERA = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
CAMERA.position.set(2, 3, 5);
CAMERA.updateMatrixWorld();

type Cas = {
  page?: VisPage;
  tri?: typeof TRI_BASE;
  affine?: { area: number };
  bary?: { w0: number; w1: number; w2: number };
  uv?: [number, number];
  mat?: VisMaterial;
  rgb?: [number, number, number];
  metalness?: number;
  roughness?: number;
};

/** Compare `shadeLit` (l'optimisée) à `referenceShadeLit` (l'oracle) sur le même cas, canal par
 *  canal, `Object.is` pour distinguer -0/0 et traiter NaN comme égal à lui-même. */
function assertSameShading(cas: Cas, label: string) {
  const a = [
    cas.page ?? pageOf(),
    cas.tri ?? TRI_BASE,
    cas.affine ?? { area: -0.42 },
    cas.bary ?? { w0: 0.5, w1: 0.3, w2: 0.2 },
    cas.uv ?? [0.35, 0.7],
    cas.mat ?? material(),
    cas.rgb ?? [0.2, 0.5, 0.9],
    cas.metalness ?? 0.3,
    cas.roughness ?? 0.5,
    CAMERA,
  ] as const;
  const optimisee = shadeLit(...a);
  const reference = referenceShadeLit(...a);
  for (let c = 0; c < 3; c++)
    assert.ok(
      Object.is(optimisee[c], reference[c]),
      `${label}, canal ${c}: ${optimisee[c]} != ${reference[c]}`,
    );
}

test('sans normale ni carte : chemin par face uniquement, plusieurs rugosités et métallicités', () => {
  for (const roughness of [0, 0.0525, 0.6, 1, 5, -3])
    for (const metalness of [0, 0.3, 1, 1.7, -1])
      assertSameShading({ metalness, roughness }, `r${roughness} m${metalness}`);
});

test('déterminant négatif (page miroir) et doubleSided/backSide combinés', () => {
  const page = pageOf({ matrix: new THREE.Matrix4().makeScale(-1, 1, 1) });
  for (const doubleSided of [false, true])
    for (const backSide of [false, true])
      assertSameShading(
        { page, affine: { area: 0.1 }, mat: material({ doubleSided, backSide }) },
        `ds${doubleSided} bs${backSide}`,
      );
});

test('aire nulle ou triangle dégénéré ne fait pas diverger la face calculée', () => {
  const zero = vertex(0, 0, 0, 1);
  const flat = { ...TRI_BASE, a: zero, b: zero, c: zero };
  assertSameShading({ tri: flat, affine: { area: 0 } }, 'aire nulle');
});

test('caméra exactement sur le point du fragment (vLen replié à 1)', () => {
  const confondu = vertex(2, 3, 5, 1);
  const tri = { ...TRI_BASE, a: confondu, b: confondu, c: confondu };
  const tiers = { w0: 1 / 3, w1: 1 / 3, w2: 1 / 3 };
  assertSameShading({ tri, bary: tiers }, 'camera confondue');
});

test('normales de sommet portées par la page, avec et sans doubleSided', () => {
  const normal = new THREE.BufferAttribute(
    new Float32Array([0, 0, 1, 0.2, 0.8, 0.1, -0.3, 0.4, 0.9]),
    3,
  );
  const page = pageOf({ attributes: { normal } });
  for (const doubleSided of [false, true])
    assertSameShading({ page, mat: material({ doubleSided }) }, `normale ds${doubleSided}`);
});

test('carte de normales avec tangente portée par la page', () => {
  const normal = new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
  const tangent = new THREE.BufferAttribute(
    new Float32Array([1, 0, 0, 1, 0.1, 0, 0, 1, 1, 0, -0.1, -1]),
    4,
  );
  const page = pageOf({ attributes: { normal, tangent } });
  const mat = material({
    normalMap: fakeTexture([200, 90, 255, 255]),
    normalScale: 1.4,
    normalScaleY: -0.6,
  });
  assertSameShading({ page, mat }, 'normalMap+tangente');
});

test('carte de normales sans tangente : dérivée par les UV portés par la page', () => {
  const uv = new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2);
  const page = pageOf({ attributes: { uv } });
  const mat = material({ normalMap: fakeTexture([10, 250, 5, 255]) });
  assertSameShading({ page, mat }, 'normalMap sans tangente');
});

test('occlusion ambiante et émission cartographiées, comparées à leur absence', () => {
  const avecCartes = material({
    aoMap: fakeTexture([64, 64, 64, 255]),
    aoIntensity: 1.8,
    emissiveMap: fakeTexture([255, 128, 0, 255]),
    emissive: [0.4, 0.1, 0.9],
  });
  assertSameShading({ mat: avecCartes }, 'ao+emissive');
  assertSameShading({}, 'sans cartes');
});
