import test from 'node:test';
import assert from 'node:assert/strict';
import { checked } from './pages.ts';
import { answering, refusedWith } from './answers.fixture.ts';

const URL_ = 'https://cache.test/model/lights.json';

test('an optional file the server does not hold (404) answers null, asked once', async (t) => {
  const asked = answering(t, 'lights.json', [404]);
  assert.equal(await checked(URL_, undefined, { optional: true }), null);
  assert.equal(asked.length, 1);
});

test('an optional file refused otherwise (403) is refused by its address, asked once', async (t) => {
  const asked = answering(t, 'lights.json', [403]);
  await assert.rejects(
    checked(URL_, undefined, { optional: true }),
    refusedWith(403, 'lights.json'),
  );
  assert.equal(asked.length, 1);
});

test('an optional file a busy server refuses once (503) is asked again and answers', async (t) => {
  const asked = answering(t, 'lights.json', [503, 200]);
  const response = await checked(URL_, undefined, { optional: true });
  assert.equal(response?.status, 200);
  assert.equal(asked.length, 2);
});

test('the credentials asked are the ones the request carries', async (t) => {
  const asked = answering(t, 'lights.json', [200]);
  await checked(URL_, undefined, { credentials: 'same-origin' });
  assert.equal(asked[0].init.credentials, 'same-origin');
});

test('an aborted read rejects with the reason and is not asked again', async (t) => {
  const asked = answering(t, 'lights.json', ['hang']);
  const abort = new AbortController();
  const read = checked(URL_, abort.signal);
  abort.abort(new Error('left'));
  await assert.rejects(read, /left/);
  assert.equal(asked.length, 1);
});
