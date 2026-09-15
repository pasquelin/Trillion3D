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
  const drawn = [{ material: visible, triangles: 100 } as PageRec];
  const priority = createTexturePriority(() => ({ index, drawn, blend: [] as BlendGpuItem[] }));

  const invisibleJob = job(2),
    visibleJob = job(1);
  const jobs = [invisibleJob, visibleJob];
  priority.order(jobs);
  assert.deepEqual(jobs, [visibleJob, invisibleJob]);

  // No usable signal yet (no material index): the queue keeps exactly the order it was built in.
  const noSignal = createTexturePriority(() => ({ index: undefined, drawn: [], blend: [] }));
  const untouched = [job(3), job(1), job(2)];
  const originalOrder = [...untouched];
  noSignal.order(untouched);
  assert.deepEqual(untouched, originalOrder);
});
