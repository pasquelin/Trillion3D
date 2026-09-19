import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { createWebgpuBlendState, type BlendGpuItem } from './webgpuBlendState.ts';

/** The blend plan of a lone item, everything but its material left at its simplest. */
function plan(material: THREE.Material | THREE.Material[]) {
  const blendState = createWebgpuBlendState();
  blendState.blendGpu.push({
    material,
    matrix: new THREE.Matrix4(),
    count: 3,
  } as unknown as BlendGpuItem);
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  return [...blendState.orders[0]];
}

test('an item that declares no material plans the host default side: one front entry, not a crash', () => {
  const front = plan(new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  assert.equal(front.length, 1);
  assert.deepEqual(plan([]), front, 'an empty material array declares nothing: front');
});
