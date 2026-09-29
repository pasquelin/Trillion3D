// #573: a geometry written every frame is uploaded in place, never cut into pages again, and the
// session that draws it is never opened again for it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { listenWorldNotices } from '../diagnostic/worldNotices.ts';
import { createWorldDynamic } from './worldDynamic.ts';
import type { Cut } from './worldCuts.ts';
import { takeContentReopens } from './worldRuntime.fixture.ts';
import { dynamicWorld } from './worldDynamic.fixture.ts';

test('a geometry rewritten 300 frames is never cut again nor reopened, and uploads its changed bytes alone', async () => {
  const world = dynamicWorld();
  const sheet = geometry.plane(4, 4, 30, 30);
  sheet.usage = 'dynamic';
  world.scene.add(object.mesh(sheet, material.meshStandard({})));
  await world.frame();
  const cutBefore = world.served.count;
  const position = sheet.attributes.position;
  for (let frame = 0; frame < 300; frame++) {
    for (let v = 100; v < 200; v++) position.setZ(v, Math.sin(frame + v) * 0.1);
    position.needsUpdate = true;
    const metrics = await world.frame();
    assert.equal(metrics?.dynamicUploadBytes, 100 * 12, `frame ${frame}: 100 positions`);
  }
  world.end();
  assert.equal(world.served.count, cutBefore, 'no page cut or served again');
  assert.equal(world.sources.length, 1, 'one session');
  assert.equal(world.rewrites.length, 300);
  for (const ranges of world.rewrites)
    assert.deepEqual(ranges, [{ name: 'position', from: 100, count: 100 }], 'the changed range');
});

test('a geometry changed on consecutive frames turns dynamic by itself, and says so naming its mesh', async () => {
  const world = dynamicWorld();
  const heard: unknown[] = [];
  const stop = listenWorldNotices(
    (n) => void (n.phase === 'geometry-dynamic' && heard.push(n.context)),
  );
  const sheet = geometry.plane(1, 1, 4, 4),
    mesh = object.mesh(sheet, material.meshStandard({}));
  mesh.name = 'sea';
  world.scene.add(mesh);
  await world.frame();
  const cuts: number[] = [];
  for (let frame = 0; frame < 10; frame++) {
    const before = world.served.count;
    sheet.attributes.position.setZ(0, (frame % 2) * 0.1);
    sheet.attributes.position.needsUpdate = true;
    await world.frame();
    cuts.push(world.served.count - before);
  }
  world.end();
  await new Promise(setImmediate);
  stop();
  takeContentReopens(); // the session stand-in mounts nothing: the dynamic resource opens it once
  assert.deepEqual(heard, [{ kind: 'lifecycle', mesh: 'sea', declared: false }]);
  assert.deepEqual(cuts.slice(2), Array(8).fill(0), 'cut on its first changes, never after');
  assert.equal(world.rewrites.length, 8);
});

test('past the frame budget an upload waits for the next frame, in order, and is never dropped', async () => {
  const dynamic = createWorldDynamic(undefined, { cuts: 0 });
  const made: Cut[] = [];
  const read = (plane: ReturnType<typeof geometry.plane>) => {
    const mesh = object.mesh(plane, material.meshStandard({}));
    dynamic.wants(mesh);
    return dynamic.of(mesh, 'faces', {}, false, (cut) => void made.push(cut));
  };
  const planes = [geometry.plane(1, 1, 9, 9), geometry.plane(1, 1, 9, 9)];
  for (const plane of planes) plane.usage = 'dynamic';
  await Promise.all(planes.map(read));
  for (const plane of planes) {
    plane.attributes.position.setZ(0, 0.1);
    plane.attributes.position.needsUpdate = true;
  }
  await Promise.all(planes.map(read));
  const written: Cut[] = [];
  const frame = () => dynamic.upload(12, (cut) => written.push(cut) > 0);
  assert.equal(frame(), 12, 'the first of the frame goes whatever its size');
  assert.deepEqual(written, [made[0]]);
  assert.equal(frame(), 12, 'the one deferred goes next');
  assert.deepEqual(written, made);
  assert.equal(frame(), 0, 'nothing left');
});
