// per-pixel shading of the CPU visbuffer.
import { importHostTexture } from '../../../packages/sdk-browser/hostSurfaceImport.ts';
import * as THREE from 'three';
import { surfaceOf } from '../../../packages/sdk-browser/pageSurface.ts';
import { shadeLit } from '../../../packages/sdk-browser/visibilityLighting.ts';
import { triangleAt } from '../../../packages/sdk-browser/visibilityMath.ts';
import type { VisMaterial, VisPage } from '../../../packages/sdk-browser/visibilityTypes.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceShadeLit } from '../../oracles/browser/eclairage-pixel.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/cameraFixture.ts';
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts';

const alea = graine(0x6017);
const HOSTILES = [...HOSTILE_FLOATS, 1];

interface Pixel {
  page: VisPage;
  tri: NonNullable<ReturnType<typeof triangleAt>>;
  affine: { area: number };
  bary: { w0: number; w1: number; w2: number };
  uv: [number, number];
  mat: VisMaterial;
  rgb: [number, number, number];
  metalness: number;
  roughness: number;
}

function texture(depart: number) {
  const data = new Uint8Array(8 * 8 * 4),
    tire = graine(depart);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(tire() * 256) & 255;
  const map = new THREE.Texture();
  map.image = { data, width: 8, height: 8 };
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  return importHostTexture(map);
}

function page(depart: number) {
  const tire = graine(depart);
  const positions = new Float32Array(9),
    normales = new Float32Array(9),
    tangentes = new Float32Array(12),
    uvs = new Float32Array(6);
  for (let i = 0; i < 9; i++) {
    positions[i] = (tire() - 0.5) * 4;
    normales[i] = tire() * 2 - 1;
  }
  for (let i = 0; i < 12; i++) tangentes[i] = tire() * 2 - 1;
  for (let i = 0; i < 6; i++) uvs[i] = tire();
  return {
    array: new Uint32Array([0, 1, 2]),
    attributes: {
      position: new THREE.BufferAttribute(positions, 3),
      normal: new THREE.BufferAttribute(normales, 3),
      tangent: new THREE.BufferAttribute(tangentes, 4),
      uv: new THREE.BufferAttribute(uvs, 2),
    },
    matrix: new THREE.Matrix4().makeRotationY(0.7).setPosition(0.3, -0.2, 0.9),
    material: surfaceOf(new THREE.MeshStandardMaterial()),
  };
}

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
camera.position.set(2, 3, 8);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();
const viewProj = new THREE.Matrix4().multiplyMatrices(
  camera.projectionMatrix,
  camera.matrixWorldInverse,
);
const depthCam = { viewProjection: new Float64Array(viewProj.elements) };

const matiere = (cartes: boolean): VisMaterial => ({
  baseColor: [0.8, 0.6, 0.4],
  metalness: 0.3,
  roughness: 0.4,
  lit: true,
  doubleSided: true,
  backSide: false,
  alphaTest: 0,
  normalMap: cartes ? texture(0x11) : undefined,
  normalScale: 1.25,
  normalScaleY: -0.75,
  aoMap: cartes ? texture(0x22) : undefined,
  aoIntensity: 0.8,
  emissive: [0.05, -0, 0.2],
  emissiveMap: cartes ? texture(0x33) : undefined,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
  attenuationColor: [1, 1, 1],
});

function pixels(nombre: number, cartes: boolean, hostiles: boolean): Pixel[] {
  const p = page(0x77 ^ nombre),
    tri = triangleAt(p, 0, depthCam, 1600, 900),
    mat = matiere(cartes);
  if (!tri) throw new Error('ECLAIRAGE_PIXEL_TRIANGLE_MANQUANT');
  const lot: Pixel[] = [];
  for (let i = 0; i < nombre; i++) {
    const w0 = hostiles ? HOSTILES[i % HOSTILES.length] : alea(),
      w1 = hostiles ? HOSTILES[(i + 3) % HOSTILES.length] : alea() * (1 - w0);
    lot.push({
      page: p,
      tri,
      affine: { area: alea() * 40 - 20 },
      bary: { w0, w1, w2: 1 - w0 - w1 },
      uv: [alea() * 3 - 1, alea() * 3 - 1],
      mat,
      rgb: [alea(), alea(), i % 5 === 0 ? -0 : alea()],
      metalness: i % 7 === 0 ? 1 : alea(),
      roughness: i % 11 === 0 ? 0 : alea(),
    });
  }
  return lot;
}

const vue = cameraMoteur(camera);

const passe =
  <Cam>(
    ombre: (
      page: VisPage,
      tri: NonNullable<ReturnType<typeof triangleAt>>,
      affine: { area: number },
      bary: { w0: number; w1: number; w2: number },
      uv: [number, number],
      mat: VisMaterial,
      rgb: [number, number, number],
      metalness: number,
      roughness: number,
      cam: Cam,
    ) => number[],
    oeil: Cam,
  ) =>
  (lot: Pixel[]) => {
    const output = new Float64Array(lot.length * 3);
    for (let i = 0; i < lot.length; i++) {
      const p = lot[i];
      const rgb = ombre(
        p.page,
        p.tri,
        p.affine,
        p.bary,
        p.uv,
        p.mat,
        p.rgb,
        p.metalness,
        p.roughness,
        oeil,
      );
      output[i * 3] = rgb[0];
      output[i * 3 + 1] = rgb[1];
      output[i * 3 + 2] = rgb[2];
    }
    return output;
  };

const resOmbrage = await mesure({
  name: 'per-pixel visbuffer shading',
  fichier: 'packages/sdk-browser/visibilityLighting.ts',
  cas: [
    {
      name: '20 000 pixels with maps',
      input: pixels(20000, true, false),
      size: 20000,
    },
    { name: '20 000 pixels without a map', input: pixels(20000, false, false), size: 20000 },
    { name: 'hostile weights', input: pixels(49, true, true), size: 49 },
    { name: 'no pixels', input: [], size: 0 },
  ],
  calcul: passe(shadeLit, vue),
  attendu: passe(referenceShadeLit, camera),
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  name: 'shadeLit extremes',
  calcul: (lot) => passe(shadeLit, vue)(lot),
  extremes: [{ name: '1 hostile pixel', input: pixels(1, true, true) }],
});

rapport(
  'eclairage-pixel',
  [resOmbrage],
  'G3 yields the same three channels, bit-exact, on every pixel',
);
