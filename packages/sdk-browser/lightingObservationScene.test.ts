import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene } from '../sdk-core/src/lighting/scene/experimentScene.ts';
import { createObservationResources } from './lightingObservationResources.ts';
import type { LightingExperimentRenderState } from './lightingObservationContracts.ts';
import type { HostNode } from './hostResources.ts';

test('the observation backend publishes an engine scene: black, empty, and walkable', () => {
  const scene = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  const state: LightingExperimentRenderState = {
    scene,
    indirectIrradiance: new Float64Array(scene.patches.length * 3),
    radiance: new Float64Array(scene.patches.length * 3),
  };
  const published = createObservationResources(state).scene;
  assert.deepEqual(published.background, { isColor: true, r: 0, g: 0, b: 0 });
  assert.deepEqual(published.children, [], 'no mesh ever enters it');
  const visited: HostNode[] = [];
  published.traverse((node) => visited.push(node));
  assert.deepEqual(visited, [published], 'a walk finds the root and nothing under it');
});
