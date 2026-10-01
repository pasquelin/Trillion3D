import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { createPlacementRows, rowParked } from '../../placement/rows.ts';
import type { Batch, Seat } from '../core/worldBatches.ts';
import { createViewMask, checkViewMaskLights } from './mask.ts';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';

test('one camera excludes a subtree from draw and shadow rows without changing scene visibility, then restores', () => {
  const scene = new Object3D(),
    housing = new Object3D(),
    shell = new Mesh(),
    other = new Mesh();
  scene.add(housing, other);
  housing.add(shell);
  scene.updateWorldMatrix(true, true);
  const rows = createPlacementRows(2);
  rows.live.fill(1);
  const batch = { rows } as Batch;
  const seats = new Map<Mesh, Seat>([
    [shell, { batch, row: 0 }],
    [other, { batch, row: 1 }],
  ]);
  const updates: number[][] = [];
  const mask = createViewMask(
    scene,
    seats,
    () => new Map(),
    (changed, from, to) => {
      assert.equal(changed, rows);
      updates.push([from, to, ...changed.live]);
    },
  );
  mask([housing, shell], () => {
    assert.equal(rowParked({ rows, index: 0 }), true);
    assert.equal(rowParked({ rows, index: 1 }), false);
    assert.equal(housing.visible && shell.visible, true);
  });
  assert.deepEqual([...rows.live], [1, 1]);
  assert.deepEqual(
    updates,
    [
      [0, 0, 0, 1],
      [0, 0, 1, 1],
    ],
    'only affected rows are uploaded',
  );
  assert.throws(
    () =>
      mask([housing], () => {
        throw new Error('draw failed');
      }),
    /draw failed/,
  );
  assert.deepEqual(
    [...rows.live],
    [1, 1],
    'a rendering failure cannot hide the next camera’s housing',
  );
  housing.visible = false;
  mask([housing], () => {});
  assert.equal(rows.live[0], 0, 'an already hidden subtree stays hidden');
});

test('different camera masks never reuse another camera’s shared lamp shadows', () => {
  const store = createSceneLightStore();
  store.add(SUN);
  assert.doesNotThrow(
    () => checkViewMaskLights(store),
    'directional shadow slices belong to each view',
  );
  store.add({
    id: 'bulb',
    kind: 'point',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 2, 0],
    range: 10,
    castsShadow: false,
  });
  assert.doesNotThrow(() => checkViewMaskLights(store));
  store.set('bulb', { castsShadow: true });
  assert.throws(() => checkViewMaskLights(store), /VIEW_EXCLUDE_SHADOW_LAMP_UNSUPPORTED/);
  const scene = new Object3D(),
    rows = createPlacementRows(1);
  rows.live[0] = 1;
  let uploads = 0,
    draws = 0;
  const mask = createViewMask(
    scene,
    new Map(),
    () => new Map(),
    () => uploads++,
    () => checkViewMaskLights(store),
  );
  assert.throws(() => mask([scene], () => draws++), /VIEW_EXCLUDE_SHADOW_LAMP_UNSUPPORTED/);
  assert.equal(
    uploads + draws,
    0,
    'refusal happens before touching shared state or drawing a partial image',
  );
});
