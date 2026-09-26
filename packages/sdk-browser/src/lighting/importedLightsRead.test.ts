import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImportedLights } from './importedLights.ts';
import { answering, refusedWith } from '../cluster/answers.fixture.ts';

const BASE = 'https://cache.test/model/';
/** A lights file of no light, one refused: read, it is told apart from none. */
const FILE = () => JSON.stringify({ version: 1, lights: [], rejected: { 'light-kind': 1 } });

test('a cache compiled before its lights (404) has none, asked once', async (t) => {
  const asked = answering(t, 'lights.json', [404]);
  assert.deepEqual(await loadImportedLights(BASE), { lights: [], rejected: {} });
  assert.equal(asked.length, 1);
});

test('a lights file refused otherwise (403) is refused by its address', async (t) => {
  answering(t, 'lights.json', [403]);
  await assert.rejects(loadImportedLights(BASE), refusedWith(403, 'lights.json'));
});

test('a lights file a busy server refuses once (503) is asked again and read', async (t) => {
  const asked = answering(t, 'lights.json', [503, 200], FILE);
  assert.deepEqual((await loadImportedLights(BASE)).rejected, { 'light-kind': 1 });
  assert.equal(asked.length, 2);
});

test('an aborted lights read rejects and is not asked again', async (t) => {
  const asked = answering(t, 'lights.json', ['hang']);
  const abort = new AbortController();
  const read = loadImportedLights(BASE, abort.signal);
  abort.abort(new Error('closed'));
  await assert.rejects(read, /closed/);
  assert.equal(asked.length, 1);
});
