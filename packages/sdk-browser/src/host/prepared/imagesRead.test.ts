import test from 'node:test';
import assert from 'node:assert/strict';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { unmetered } from '../../cluster/byteMeter.ts';
import { answering } from '../../cluster/answers.fixture.ts';
import { preparedImages } from './images.ts';
import { decodingImages } from './decodedImages.fixture.ts';

/** A document of one image beside it, `a.png`. */
const document = {
  images: [{ uri: 'a.png', view: null, mimeType: 'image/png' }],
  views: [],
} as unknown as TableDocument;

test('an image the server refuses (404) is no image, logged by its address, asked once', async (t) => {
  const asked = answering(t, 'a.png', [404]);
  decodingImages(t);
  const logged = t.mock.method(console, 'error', () => {});
  const images = preparedImages({
    ...{ document, documentUrl: 'https://cache.test/model/source.gltf', binary: null },
    ...{ skipped: new Set<string>(), signal: undefined, meter: unmetered },
    track: (_resource, read) => read,
  });
  assert.equal(await images(0), null);
  assert.equal(asked.length, 1);
  assert.match(String(logged.mock.calls[0].arguments[2]), /a\.png: HTTP 404/);
});

test('an image a busy server refuses once (503) is asked again and decoded', async (t) => {
  const asked = answering(t, 'a.png', [503, 200], () => new Uint8Array([1, 2, 3]));
  decodingImages(t);
  const images = preparedImages({
    ...{ document, documentUrl: 'https://cache.test/model/source.gltf', binary: null },
    ...{ skipped: new Set<string>(), signal: undefined, meter: unmetered },
    track: (_resource, read) => read,
  });
  assert.deepEqual(await images(0), { width: 1, height: 1, bytes: 3 });
  assert.equal(asked.length, 2);
});
