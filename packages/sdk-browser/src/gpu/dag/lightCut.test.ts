// The cluster cut seen from a light: the same kernel — here its node oracle, which the GPU
// matches bit for bit — run on the view of a shadow face. It selects casters the camera cannot
// see, counts their error in the face's texels, and keeps only what covers a redrawn page.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { evaluateDagSelectionKernel, packedWorldsToRenderOrigin } from './selection.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts';
import { sunRun } from '../../webgpu/shadow/runs.fixture.ts';

/** A camera five metres in front of the fixture, looking away from it. */
function cameraFacingAway() {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, -5);
  cam.lookAt(0, 0, -10);
  cam.updateMatrixWorld();
  return cam;
}

const sunFace = (side: number, origin: number[], mark?: number[]) =>
  sunRun(side, origin, mark).uniforms;

const urls = (dag: ReturnType<typeof packed>['dag'], ids: number[]) =>
  ids.map((id) => dag.pageUrls[id]).sort();

test('casters behind the camera are selected from the light, which the camera cut never keeps', () => {
  const { dag, roots } = packed(dagFixture());
  const camera = kernelUniforms(dag, roots, cameraFacingAway(), 1);
  assert.deepEqual(evaluateDagSelectionKernel(dag, camera).pageIds, [], 'the camera sees none');
  const light = sunFace(1024, camera.cameraWorld);
  assert.deepEqual(
    urls(dag, evaluateDagSelectionKernel(dag, light).pageIds),
    ['leaf0', 'leaf1', 'leaf2', 'leaf3'],
    'the light keeps all four leaves: a 1024-texel face over 8 m wants their detail',
  );
});

test("a caster's error is counted in the face's texels: a coarse face takes the coarse cluster", () => {
  const { dag, roots } = packed(dagFixture());
  const origin = [0, 0, -5];
  packedWorldsToRenderOrigin(dag, roots, Float64Array.from(origin));
  // 32 texels over 8 m: 4 texels per metre, so the root's 0.2 m error is under one texel.
  assert.deepEqual(urls(dag, evaluateDagSelectionKernel(dag, sunFace(32, origin)).pageIds), [
    'root',
  ]);
  // 256 texels: 32 per metre, the root's error is 6.4 texels, the middle's 0.64.
  assert.deepEqual(urls(dag, evaluateDagSelectionKernel(dag, sunFace(256, origin)).pageIds), [
    'mid-left',
    'mid-right',
  ]);
});

test('a light cut keeps only what covers a page its face redraws', () => {
  const { dag, roots } = packed(dagFixture());
  const origin = [0, 0, -5];
  packedWorldsToRenderOrigin(dag, roots, Float64Array.from(origin));
  const corner = sunFace(1024, origin, [0, 0, 0, 0]);
  assert.deepEqual(evaluateDagSelectionKernel(dag, corner).pageIds, [], 'a far corner page');
  const centre = sunFace(1024, origin, [3, 4, 3, 4]);
  assert.equal(evaluateDagSelectionKernel(dag, centre).pageIds.length, 4, 'the centre pages');
});
