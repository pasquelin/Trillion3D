import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { answering, refusedWith, type Answer } from '../cluster/answers.fixture.ts';
import { cooked, landed, modelStreamer, place, tile } from './tiles.fixture.ts';

/** A `physics.json` of one two-triangle tile, `t0.bin`, placed once. */
const FILE = () => JSON.stringify(cooked([{ kind: 'mesh', tiles: [tile()] }], [place(0)]));
const served = (url: string) =>
  url.endsWith('physics.json') ? new Response(FILE()) : new Response('missing', { status: 404 });

/** A model streamer whose `name` answers `answers` and every other file `served`, scanned once. */
function streaming(t: TestContext, name: string, answers: Answer[]) {
  const asked = answering(t, name, answers, name === 'physics.json' ? FILE : () => 'tile', served);
  const streamer = modelStreamer();
  const opened = streamer.heard();
  streamer.tiles.scan(streamer.scene);
  return { ...streamer, asked, opened };
}

test('a model compiled before the cook (no physics.json, 404) collides nowhere and fails nothing', async (t) => {
  const { tiles, bodies, errors, asked } = streaming(t, 'physics.json', [404]);
  await landed();
  tiles.update([0, 0, 0], 1000);
  await landed();
  assert.deepEqual([asked.length, bodies.count.triangles, errors], [1, 0, []]);
});

test('a physics.json a busy server refuses once (503) is asked again and its tiles placed', async (t) => {
  const { asked, opened, errors } = streaming(t, 'physics.json', [503, 200]);
  await opened;
  assert.deepEqual([asked.length, errors], [2, []]);
});

test('a tile the server does not hold (404) is refused by its address, asked once', async (t) => {
  const { tiles, asked, opened, heard, errors } = streaming(t, 't0.bin', [404]);
  await opened;
  const refused = heard();
  tiles.update([0, 0, 0], 1000);
  await refused;
  assert.ok(refusedWith(404, 't0.bin')(errors[0]));
  assert.equal(asked.length, 1);
});

test('a tile a busy server refuses once (503) is asked again and resident', async (t) => {
  const { tiles, bodies, asked, opened, heard, errors } = streaming(t, 't0.bin', [503, 200]);
  await opened;
  const resident = heard();
  tiles.update([0, 0, 0], 1000);
  await resident;
  assert.deepEqual([asked.length, bodies.count.triangles, errors], [2, 2, []]);
});

test('a model leaving while its tile is on its way lets the read go: no failure, no second ask', async (t) => {
  const { tiles, scene, model, asked, opened, errors } = streaming(t, 't0.bin', ['hang']);
  await opened;
  tiles.update([0, 0, 0], 1000);
  const signal = asked[0].init.signal!;
  scene.remove(model);
  tiles.scan(scene);
  assert.ok(signal.aborted);
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
