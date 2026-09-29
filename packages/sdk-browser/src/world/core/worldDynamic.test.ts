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

test("the session's own loop hands its frame hooks the upload bytes, and still detects a rewrite", async () => {
  const world = dynamicWorld();
  const sheet = geometry.plane(1, 1, 4, 4);
  world.scene.add(object.mesh(sheet, material.meshStandard({})));
  await world.loop();
  const bytes: unknown[] = [];
  for (let frame = 0; frame < 10; frame++) {
    sheet.attributes.position.setZ(0, (frame % 2) * 0.1);
    sheet.attributes.position.needsUpdate = true;
    bytes.push((await world.loop()).dynamicUploadBytes);
  }
  world.end();
  await new Promise(setImmediate);
  takeContentReopens(); // the session stand-in mounts nothing: the dynamic resource opens it once
  assert.ok(
    bytes.every((b) => typeof b === 'number'),
    `every frame told: ${bytes}`,
  );
  assert.deepEqual(bytes.slice(-4), Array(4).fill(12), 'one position a frame, uploaded in place');
});

type Plane = ReturnType<typeof geometry.plane>;
/** Reads `plane`, declared dynamic, as a mesh drawing it would; `made` gets each new resource. */
function reader(dynamic: ReturnType<typeof createWorldDynamic>, plane: Plane, made: Cut[] = []) {
  plane.usage = 'dynamic';
  const mesh = object.mesh(plane, material.meshStandard({}));
  return () => (dynamic.wants(mesh), dynamic.of(mesh, 'faces', {}, false, (c) => made.push(c)));
}
/** Moves vertex `v` of `plane` to `z`, the list written. */
const rewrite = (plane: Plane, v: number, z: number) => {
  plane.attributes.position.setZ(v, z);
  plane.attributes.position.needsUpdate = true;
};
/** An upload's bytes, those of the lists themselves. */
const weighed = (_: Cut, __: unknown, bytes: number) => bytes;

test('a rewrite is read into the lists its resource holds: a steady frame makes no list', async () => {
  const dynamic = createWorldDynamic(undefined, { cuts: 0 });
  const plane = geometry.plane(1, 1, 3, 3),
    read = reader(dynamic, plane);
  const cut = (await read())!;
  const lists = () => [cut.drawn.positions, cut.dynamic!.next.positions, cut.dynamic!.next.normals];
  const before = lists();
  for (let frame = 1; frame < 4; frame++) {
    rewrite(plane, 5, frame / 100);
    assert.equal(await read(), cut, `frame ${frame}: the same resource`);
    assert.equal(dynamic.upload(1 << 20, { weigh: weighed, write: () => true }), 12);
  }
  assert.deepEqual(lists(), before, 'the same lists');
  assert.equal(cut.drawn.positions[17], Math.fround(0.03), 'the last rewrite held');
});

test('past the frame budget an upload waits for the next frame, in order, and is never dropped', async () => {
  const dynamic = createWorldDynamic(undefined, { cuts: 0 });
  const made: Cut[] = [];
  const planes = [geometry.plane(1, 1, 9, 9), geometry.plane(1, 1, 9, 9)];
  const reads = planes.map((plane) => reader(dynamic, plane, made));
  await Promise.all(reads.map((read) => read()));
  for (const plane of planes) rewrite(plane, 0, 0.1);
  await Promise.all(reads.map((read) => read()));
  const written: Cut[] = [];
  const uploads = { weigh: weighed, write: (cut: Cut) => written.push(cut) > 0 };
  const frame = () => dynamic.upload(12, uploads);
  assert.equal(frame(), 12, 'the first of the frame goes whatever its size');
  assert.equal(written.length, 1, 'the second waits');
  assert.equal(frame(), 12, 'the one deferred goes next');
  assert.deepEqual(new Set(written), new Set(made)); // `made` in the order the cuts ended
  assert.equal(frame(), 0, 'nothing left');
});

test('vertices that leave the held box serve the same pages in a larger one, nothing cut', async () => {
  const counts = { cuts: 0 },
    made: Cut[] = [];
  const plane = geometry.plane(1, 1, 2, 2),
    read = reader(createWorldDynamic(undefined, counts), plane, made);
  await read();
  rewrite(plane, 0, 40);
  const grown = (await read())!;
  assert.equal(counts.cuts, 1, 'cut once, at first sight');
  assert.equal(made.length, 2, 'served again');
  assert.ok(grown.dynamic!.box[5] >= 40, 'in a box that holds the vertex');
  assert.equal(grown.dynamic!.cut, made[0].dynamic!.cut, 'the same pages');
});
