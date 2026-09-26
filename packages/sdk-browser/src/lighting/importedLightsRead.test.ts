import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImportedLights } from './importedLights.ts';
import { answering } from '../cluster/answers.fixture.ts';

const BASE = 'https://cache.test/model/';

test('a cache without its lights — a 404, or the 403 of a store that hides it — has none', async (t) => {
  for (const status of [404, 403]) {
    t.mock.restoreAll();
    answering(t, 'lights.json', [status]);
    assert.deepEqual(await loadImportedLights(BASE), { lights: [], rejected: {} });
  }
});

test('a lights read aborted while its body arrives rejects, never answering no lights', async (t) => {
  const abort = new AbortController();
  // The body breaks off as the read is aborted, the way a browser's does.
  const body = new ReadableStream({
    pull(stream) {
      abort.abort(new Error('closed'));
      stream.error(new DOMException('Aborted', 'AbortError'));
    },
  });
  answering(t, 'lights.json', [200], () => body);
  await assert.rejects(loadImportedLights(BASE, abort.signal), /closed/);
});
