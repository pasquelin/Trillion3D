import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene } from './scene/experimentScene.ts';
import { createObservationResources } from './resources.ts';
import { updateObservation } from './update.ts';
import { createObservationDraw } from './draw.ts';
import { createRectangleBvh } from './rectangleBvh.ts';
import type { LightingExperimentRenderState } from './contracts.ts';
import { createTestContext } from '../../../packages/sdk-browser/src/webgl/core/testContext.fixture.ts';
import { createHostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';

const meshes = { copies: [], triangles: 0, geometryAllocationBytes: 0, updateTransforms() {} };
function fixture() {
  const scene = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  const state: LightingExperimentRenderState = {
    scene,
    indirectIrradiance: new Float64Array(scene.patches.length * 3),
    radiance: new Float64Array(scene.patches.length * 3),
  };
  return { state, resources: createObservationResources(state) };
}

test('brute creates no BVH; mode changes retain its node layout and refit current surfaces', () => {
  const { state, resources } = fixture();
  updateObservation(state, resources, meshes);
  assert.equal(resources.bvhTexture, undefined);
  assert.equal(state.rayDiagnostics?.bvhNodeBytes, 0);
  assert.equal(state.rayDiagnostics?.bvhNodeCount, 0);
  state.rayTraversal = 'bvh';
  updateObservation(state, resources, meshes);
  const texture = resources.bvhTexture!;
  const expected = createRectangleBvh(state.scene.surfaces);
  expected.refit(resources.surfaceTexels);
  assert.deepEqual(texture.data, expected.data);
  state.rayTraversal = 'brute';
  state.scene = createLightingScene({ doorAngle: 1, lightIntensity: 1 });
  const previous = texture.data.slice();
  updateObservation(state, resources, meshes);
  assert.deepEqual(texture.data, previous);
  assert.equal(state.rayDiagnostics?.bvhRefitMs, 0);
  state.rayTraversal = 'bvh';
  updateObservation(state, resources, meshes);
  expected.refit(resources.surfaceTexels);
  assert.equal(resources.bvhTexture, texture);
  assert.deepEqual(texture.data, expected.data);
  assert.notDeepEqual(texture.data, previous);
});

test('brute uploads only cache and surfaces; BVH uploads are lazy across mode changes and restore', () => {
  const { state, resources } = fixture();
  const context = createTestContext();
  const draw = createObservationDraw(context.gl, resources, meshes);
  const camera = createHostDrawCamera();
  const render = () => {
    updateObservation(state, resources, meshes);
    draw.drawHostGeometry(camera, { toneMapped: false, framebuffer: null, width: 8, height: 4 });
  };
  render();
  assert.equal(context.of('createTexture').length, 2);
  assert.deepEqual(
    context.of('texImage2D').map((args) => args[8]),
    [resources.texels, resources.surfaceTexels],
  );
  state.rayTraversal = 'bvh';
  render();
  assert.equal(context.of('createTexture').length, 3);
  assert.equal(context.of('texImage2D').at(-1)?.[8], resources.bvhTexture!.data);
  state.rayTraversal = 'brute';
  const count = context.of('texImage2D').length;
  render();
  assert.equal(context.of('texImage2D').length - count, 2);
  state.rayTraversal = 'bvh';
  render();
  assert.equal(context.of('createTexture').length, 3);
  context.canvas.dispatch('webglcontextrestored');
  render();
  assert.equal(context.of('createTexture').length, 6);
  assert.equal(context.of('texImage2D').at(-1)?.[8], resources.bvhTexture!.data);
  draw.dispose();
  assert.equal(context.of('deleteTexture').length, 6);
});
