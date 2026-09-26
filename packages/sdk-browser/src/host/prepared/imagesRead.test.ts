import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { unmetered } from '../../cluster/byteMeter.ts';
import { answering } from '../../cluster/answers.fixture.ts';
import { preparedImages } from './images.ts';

/** A document of one image beside it, `a.png`. */
const document = {
  images: [{ uri: 'a.png', view: null, mimeType: 'image/png' }],
  views: [],
} as unknown as TableDocument;

/** The image reader of `document`, decoding into a stand-in bitmap; failures it logs are kept. */
function reader(t: TestContext, signal?: AbortSignal) {
  const scope = globalThis as { createImageBitmap?: unknown };
  scope.createImageBitmap = async () => ({ width: 1, height: 1 });
  t.after(() => delete scope.createImageBitmap);
  const logged = t.mock.method(console, 'error', () => {});
  const images = preparedImages({
    ...{ document, documentUrl: 'https://cache.test/model/source.gltf', binary: null },
    ...{ skipped: new Set<string>(), signal, meter: unmetered },
    track: (_resource, read) => read,
  });
  return { image: images(0), logged };
}

test('an image the server does not hold (404) is no image, logged and asked once', async (t) => {
  const asked = answering(t, 'a.png', [404]);
  const { image, logged } = reader(t);
  assert.equal(await image, null);
  assert.equal(asked.length, 1);
  assert.match(String(logged.mock.calls[0].arguments[2]), /a\.png: HTTP 404/);
});

test('an image a busy server refuses once (503) is asked again and decoded', async (t) => {
  const asked = answering(t, 'a.png', [503, 200]);
  const { image } = reader(t);
  assert.deepEqual(await image, { width: 1, height: 1 });
  assert.equal(asked.length, 2);
  assert.equal(asked[1].init.credentials, 'same-origin');
});

test('an aborted image read rejects and is not asked again', async (t) => {
  const asked = answering(t, 'a.png', ['hang']);
  const abort = new AbortController();
  const { image } = reader(t, abort.signal);
  abort.abort(new Error('closed'));
  await assert.rejects(image, /closed/);
  assert.equal(asked.length, 1);
});
