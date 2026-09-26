import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { answering, type Answer } from '../cluster/answers.fixture.ts';
import { cooked, landed, modelFiles, modelStreamer, place, tile } from './tiles.fixture.ts';

/** A model of one two-triangle tile, `t0.bin`, placed once, whose `name` answers `answers` and
 *  every other file as it is: its streamer, scanned once, and the requests of `name`. */
function streaming(t: TestContext, name: string, answers: Answer[]) {
  const served = modelFiles(
    cooked([{ kind: 'mesh', tiles: [tile()] }], [place(0)]),
    new Uint8Array(1),
  );
  const asked = answering(t, name, answers, served, served);
  const streamer = modelStreamer();
  const opened = streamer.heard();
  streamer.tiles.scan(streamer.scene);
  return { ...streamer, asked, opened };
}

test('a model compiled before the cook — a 404, or the 403 of a store that hides it — collides nowhere', async (t) => {
  for (const status of [404, 403]) {
    t.mock.restoreAll();
    const { tiles, bodies, errors } = streaming(t, 'physics.json', [status]);
    await landed();
    tiles.update([0, 0, 0], 1000);
    await landed();
    assert.deepEqual([bodies.count.triangles, errors], [0, []]);
  }
});

test('a tile a busy server refuses (503) is asked once per update: the next one brings it in', async (t) => {
  const { tiles, bodies, asked, opened, heard, errors } = streaming(t, 't0.bin', [503, 200]);
  await opened;
  const refused = heard();
  tiles.update([0, 0, 0], 1000);
  await refused;
  assert.deepEqual([asked.length, errors.length], [1, 1]);
  const resident = heard();
  tiles.update([0, 0, 0], 1000);
  await resident;
  assert.deepEqual([asked.length, bodies.count.triangles], [2, 2]);
});

test('a tile the server refuses (404) is asked once, never at the next updates', async (t) => {
  const { tiles, asked, opened, heard, errors } = streaming(t, 't0.bin', [404]);
  await opened;
  const refused = heard();
  tiles.update([0, 0, 0], 1000);
  await refused;
  tiles.update([0, 0, 0], 1000);
  await landed();
  assert.deepEqual([asked.length, errors.length], [1, 1]);
});

test('a cooked file that lists no soft bodies still brings its tiles in, no failure', async (t) => {
  const { softBodies: _none, ...file } = cooked([{ kind: 'mesh', tiles: [tile()] }], [place(0)]);
  const served = modelFiles(file, new Uint8Array(1));
  answering(t, 't0.bin', [200], served, served);
  const { tiles, scene, bodies, errors } = modelStreamer();
  tiles.scan(scene);
  await landed();
  tiles.update([0, 0, 0], 1000);
  await landed();
  assert.deepEqual([bodies.count.triangles, errors], [2, []]);
});

test('a model leaving while its tile is on its way lets the read go: no failure, no second ask', async (t) => {
  const { tiles, scene, model, asked, opened, errors } = streaming(t, 't0.bin', ['hang']);
  await opened;
  tiles.update([0, 0, 0], 1000);
  scene.remove(model);
  tiles.scan(scene);
  assert.ok(asked[0].init.signal!.aborted);
  await landed();
  assert.deepEqual([asked.length, errors], [1, []]);
});

test('a model leaving while its physics.json is on its way lets the read go, no failure', async (t) => {
  const { tiles, scene, model, asked, errors } = streaming(t, 'physics.json', ['hang']);
  scene.remove(model);
  tiles.scan(scene);
  assert.ok(asked[0].init.signal!.aborted);
  await landed();
  assert.deepEqual([asked.length, errors], [1, []]);
});
