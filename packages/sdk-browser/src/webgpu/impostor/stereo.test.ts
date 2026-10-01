import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpostors, type ImpostorSection } from '../../../../sdk-core/src/index.ts';
import { bakedMesh } from '../../../../sdk-core/src/impostor/bakedMesh.fixture.ts';
import { createEngineCamera } from '../../camera/world.ts';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import { constrainStereoImpostors } from './stereo.ts';

test('a shared cut keeps geometry when only one eye accepts its impostor, in either eye order', () => {
  const root = ruleDag(8),
    world = [...root.world.elements];
  world[14] = -200;
  const roots = [{ ...root, mesh: 1, world: { elements: world } }];
  const section: ImpostorSection = {
    version: 1,
    frames: 12,
    focalPixels: 500,
    textureLimit: 8192,
    baked: 1,
    refused: 0,
    meshes: [
      bakedMesh(1, 'tree', {
        objectRadius: 4.2,
        rootTriangles: 2100,
        coverage: 0.43,
        frameSide: 128,
      }),
    ],
  };
  const far = createEngineCamera(),
    near = createEngineCamera();
  for (const camera of [far, near]) {
    camera.view.set(root.world.elements);
    camera.projection[0] = camera.projection[5] = 1;
  }
  near.view[14] = 195;
  const left = planImpostors(roots, section, far.view, 500);
  assert.equal(left.switched[0], 1);
  assert.equal(planImpostors(roots, section, near.view, 500).switched[0], 0);
  for (const cameras of [
    [far, near],
    [near, far],
  ]) {
    const plan = planImpostors(roots, section, far.view, 500);
    constrainStereoImpostors(
      roots,
      section,
      cameras.map((camera) => ({ camera, viewport: [1000, 1000] })),
      plan,
    );
    assert.equal(plan.switched[0], 0);
  }
  constrainStereoImpostors(roots, section, [{ camera: far, viewport: [1000, 1000] }], left);
  assert.equal(
    left.switched[0],
    1,
    'an admissible card is retained rather than disabling the effect',
  );
});
