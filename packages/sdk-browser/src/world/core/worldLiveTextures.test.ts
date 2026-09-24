// #362: a canvas redrawn every frame — `needsUpdate` after each drawing — kept its material's key
// moving, so each frame was a new material entry and a reopened session. The picture alone moves
// now: the entry is repainted in place, blended or not, and the open session refreshed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { texture } from '../texture/index.ts';
import { createWorldMaterials } from './worldMaterials.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

const canvas = () => ({ width: 4, height: 4 }) as HTMLCanvasElement;

test('120 redrawn pictures keep one entry, blended or shared, and no value is copied', () => {
  const table = createWorldMaterials();
  const map = texture.canvas(canvas());
  const glass = material.meshBasic({ map, transparent: true, opacity: 0.5 }),
    other = material.meshBasic({ map, transparent: true, opacity: 0.5 });
  const entry = table.entryOf(glass);
  assert.equal(table.entryOf(other), entry, 'two wearers, one entry');
  for (let frame = 0; frame < 120; frame++) {
    map.needsUpdate = true;
    assert.equal(table.entryOf(glass), entry, `frame ${frame}: the entry kept`);
    assert.equal(table.entryOf(other), entry, `frame ${frame}: for both wearers`);
    assert.deepEqual(table.takeRepainted(), [entry], `frame ${frame}: repainted once`);
  }
  assert.equal(table.counts.duplicates, 1, 'only the first fold');
  // A value written on a blended surface is still copied on write.
  glass.opacity = 0.25;
  assert.notEqual(table.entryOf(glass), entry);
});

test('a canvas redrawn for 120 frames refreshes the open session and never reopens it', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { session } = sessionStandIn();
  let opened = 0,
    refreshed = 0;
  Object.assign(session, { refreshMaterials: () => (refreshed++, true) });
  const open = (async () => (opened++, session)) as unknown as Open;
  const runtime = runtimeOf(scene, ready, (error) => assert.fail(String(error)), open);
  const map = texture.canvas(canvas());
  const screen = material.meshBasic({ map, transparent: true, opacity: 0.9 });
  scene.add(object.mesh(geometry.plane(16, 9), screen));
  await runtime.settled();
  runtime.render();
  assert.equal(opened, 1);
  for (let frame = 0; frame < 120; frame++) {
    map.needsUpdate = true;
    await runtime.settled();
    runtime.render();
  }
  runtime.dispose();
  assert.equal(opened, 1, 'one session for 120 frames');
  assert.equal(refreshed, 120, 'refreshed at each new picture');
});
