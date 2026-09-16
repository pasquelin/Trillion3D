import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createTexturePriority,
  type MaterialLayerIndex,
  type PriorityCamera,
} from './webgpuTexturePriority.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

function job(slot: number, stage = 1): TextureJob {
  return {
    kind: 'color',
    slot,
    classIndex: 0,
    layer: slot,
    level: 0,
    stage,
    bytes: 4,
    rows: 1,
    bytesPerRow: 4,
    nextRow: 0,
    failures: 0,
    uploadRows: () => {},
  };
}

/** Une caméra de vue identité : un point du monde est son propre point de vue. */
function camera(): PriorityCamera {
  const view = new Float64Array(16);
  view[0] = view[5] = view[10] = view[15] = 1;
  const projection = new Float64Array(16);
  projection[0] = projection[5] = 1;
  return { view, projection, near: 0.1 };
}
const VIEWPORT: [number, number] = [1000, 1000];
const MATRIX = new THREE.Matrix4();
/** Largeur en texels de chaque couche : une texture de 4 096 sur tous les slots du test. */
const TEXELS = new Float64Array([0, 4096, 4096, 4096]);

/** Une page cubique d'un demi-côté, centrée à `depth` devant l'œil. */
function page(material: THREE.Material, depth: number): PageRec {
  return {
    material,
    matrix: MATRIX,
    min: [-1, -1, -depth - 1],
    max: [1, 1, -depth + 1],
  } as PageRec;
}

test('la couche que la caméra regarde de près passe devant une couche lointaine, et devant une couche invisible', () => {
  const proche = new THREE.MeshStandardMaterial();
  const loin = new THREE.MeshStandardMaterial();
  const invisible = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([
    [proche, { color: [1], data: [] }],
    [loin, { color: [2], data: [] }],
    [invisible, { color: [3], data: [] }],
  ]);
  // La couche lointaine porte cent fois plus de triangles : le nombre de triangles ne décide plus.
  const requested = [page(loin, 200), page(proche, 5)];
  const priority = createTexturePriority(() => ({
    index,
    requested,
    blend: [] as BlendGpuItem[],
    cam: camera(),
    viewport: VIEWPORT,
    colorTexels: TEXELS,
    dataTexels: TEXELS,
  }));

  const jobs = [job(3), job(2), job(1)];
  priority.order(jobs);
  assert.deepEqual(
    jobs.map((entry) => entry.slot),
    [1, 2, 3],
  );

  // Aucun signal exploitable (ni index, ni caméra) : la file garde exactement l'ordre où elle a
  // été bâtie.
  const noSignal = createTexturePriority(() => ({
    index: undefined,
    requested: [],
    blend: [],
    cam: undefined,
    viewport: undefined,
    colorTexels: undefined,
    dataTexels: undefined,
  }));
  const untouched = [job(3), job(1), job(2)];
  const originalOrder = [...untouched];
  noSignal.order(untouched);
  assert.deepEqual(untouched, originalOrder);
});

// Comportement 8 : à poids égal, les niveaux progressifs d'une texture (stage 0) passent devant sa
// pleine résolution (stage 1) — quelques kilooctets donnent une image lisible avant les mégaoctets.
test('à poids égal, un niveau progressif passe devant la pleine résolution de la même texture', () => {
  const visible = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([[visible, { color: [1], data: [] }]]);
  const requested = [page(visible, 5)];
  const priority = createTexturePriority(() => ({
    index,
    requested,
    blend: [] as BlendGpuItem[],
    cam: camera(),
    viewport: VIEWPORT,
    colorTexels: undefined,
    dataTexels: undefined,
  }));
  const full = job(1, 1),
    level = job(1, 0);
  const jobs = [full, level];
  priority.order(jobs);
  assert.deepEqual(jobs, [level, full]);
});

// La queue de mips d'une texture tient en quelques kilooctets, une pleine résolution remplit le
// budget d'une image entière : aucun niveau progressif n'attend derrière une pleine résolution,
// même celle de la surface la plus large de l'image.
test('tous les niveaux progressifs passent avant toute pleine résolution, quelle que soit la place à l’écran', () => {
  const large = new THREE.MeshStandardMaterial(),
    petit = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([
    [large, { color: [1], data: [] }],
    [petit, { color: [2], data: [] }],
  ]);
  const requested = [page(large, 3), page(petit, 300)];
  const priority = createTexturePriority(() => ({
    index,
    requested,
    blend: [] as BlendGpuItem[],
    cam: camera(),
    viewport: VIEWPORT,
    colorTexels: undefined,
    dataTexels: undefined,
  }));
  const largeFull = job(1, 1),
    petitLevel = job(2, 0);
  const jobs = [largeFull, petitLevel];
  priority.order(jobs);
  assert.deepEqual(jobs, [petitLevel, largeFull]);
});

// Une couche couleur qui manque se voit — la surface reste au niveau grossier de sa pyramide ; une
// couche de données qui manque rend les facteurs scalaires du matériau. La couleur passe d'abord,
// même quand une couche de données pèse davantage.
test('à étage égal, une couche couleur passe avant une couche de données plus lourde', () => {
  const material = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([[material, { color: [1], data: [1] }]]);
  const requested = [page(material, 5)];
  const priority = createTexturePriority(() => ({
    index,
    requested,
    blend: [] as BlendGpuItem[],
    cam: camera(),
    viewport: VIEWPORT,
    colorTexels: undefined,
    dataTexels: undefined,
  }));
  const data = { ...job(1), kind: 'data' as const },
    color = job(1);
  const jobs = [data, color];
  priority.order(jobs);
  assert.deepEqual(jobs, [color, data]);
});
