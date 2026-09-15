import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTexturePriority, type MaterialLayerIndex } from './webgpuTexturePriority.ts';
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

test('une couche lue par des pages dessinées passe devant une couche invisible ; sans coupe, l’ordre d’origine est gardé', () => {
  const visible = new THREE.MeshStandardMaterial();
  const invisible = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([
    [visible, { color: [1], data: [] }],
    [invisible, { color: [2], data: [] }],
  ]);
  const requested = [{ material: visible, triangles: 100 } as PageRec];
  const priority = createTexturePriority(() => ({ index, requested, blend: [] as BlendGpuItem[] }));

  const invisibleJob = job(2),
    visibleJob = job(1);
  const jobs = [invisibleJob, visibleJob];
  priority.order(jobs);
  assert.deepEqual(jobs, [visibleJob, invisibleJob]);

  // No usable signal yet (no material index): the queue keeps exactly the order it was built in.
  const noSignal = createTexturePriority(() => ({ index: undefined, requested: [], blend: [] }));
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
  const requested = [{ material: visible, triangles: 10 } as PageRec];
  const priority = createTexturePriority(() => ({ index, requested, blend: [] as BlendGpuItem[] }));
  const full = job(1, 1),
    level = job(1, 0);
  const jobs = [full, level];
  priority.order(jobs);
  assert.deepEqual(jobs, [level, full]);
});

// La queue de mips d'une texture tient en quelques kilooctets, une pleine résolution remplit le
// budget d'une image entière : aucun niveau progressif n'attend derrière une pleine résolution,
// même celle de la surface la plus lourde de l'image.
test('tous les niveaux progressifs passent avant toute pleine résolution, quel que soit le poids', () => {
  const heavy = new THREE.MeshStandardMaterial(),
    light = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([
    [heavy, { color: [1], data: [] }],
    [light, { color: [2], data: [] }],
  ]);
  const requested = [
    { material: heavy, triangles: 100000 } as PageRec,
    { material: light, triangles: 1 } as PageRec,
  ];
  const priority = createTexturePriority(() => ({ index, requested, blend: [] as BlendGpuItem[] }));
  const heavyFull = job(1, 1),
    lightLevel = job(2, 0);
  const jobs = [heavyFull, lightLevel];
  priority.order(jobs);
  assert.deepEqual(jobs, [lightLevel, heavyFull]);
});

// Une couche couleur qui manque se voit — la surface reste au niveau grossier de sa pyramide ; une
// couche de données qui manque rend les facteurs scalaires du matériau. La couleur passe d'abord,
// même quand une couche de données pèse davantage.
test('à étage égal, une couche couleur passe avant une couche de données plus lourde', () => {
  const material = new THREE.MeshStandardMaterial();
  const index: MaterialLayerIndex = new Map([[material, { color: [1], data: [1] }]]);
  const requested = [{ material, triangles: 500 } as PageRec];
  const priority = createTexturePriority(() => ({ index, requested, blend: [] as BlendGpuItem[] }));
  const data = { ...job(1), kind: 'data' as const },
    color = job(1);
  const jobs = [data, color];
  priority.order(jobs);
  assert.deepEqual(jobs, [color, data]);
});
