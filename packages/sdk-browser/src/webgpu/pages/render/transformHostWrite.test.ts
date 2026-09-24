// A host pose write, then `setTransform` on another node in the same task (#358). The move settles
// the scene watch: without care, the host's write was taken as the engine's own, the next image did
// not walk the world index, and only the named node's rows were rewritten — the other model kept
// its old world, corners and windings in the visibility table while the GPU cut saw it moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setWebgpuTransform } from './transform.ts';
import { runtime } from '../../core/transformShear.fixture.ts';
import { hostWorldPlacements } from '../../../host/world/placements.ts';

/** Two drawn models, A and B, watched by the gate as the first image leaves them. */
function twoModels() {
  const source = new THREE.Object3D(),
    a = new THREE.Mesh(),
    b = new THREE.Mesh();
  a.name = 'A';
  b.name = 'B';
  source.add(a, b);
  const worlds = hostWorldPlacements(source),
    { rt, run } = runtime(source, [], worlds);
  run.gate.readScene(source, [{ sourceMesh: a }, { sourceMesh: b }]);
  run.gate.updateWorlds(worlds);
  return { a, worlds, rt, run };
}

const moved = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);

test('A written by the host, then B moved: the next image walks, and every row is rewritten', () => {
  const { a, worlds, rt, run } = twoModels();
  a.position.x = 100;
  setWebgpuTransform(rt, 'B', moved);
  // `render.ts` rewrites the whole table (`tableEpoch`) when this walk happens: A's rows with them.
  assert.equal(run.gate.updateWorlds(worlds), true, 'the host write is not swallowed');
  assert.equal(worlds.of(a).elements[12], 100);
});

test('B moved alone: the next image walks nothing, and only its rows travel', () => {
  const { worlds, rt, run } = twoModels();
  setWebgpuTransform(rt, 'B', moved);
  assert.equal(run.gate.updateWorlds(worlds), false);
});
