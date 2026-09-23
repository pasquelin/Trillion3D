import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { frontCamera } from '../../backend/pagesBackendScenes.fixture.ts';
import {
  disposePagedQuad,
  pagedQuad,
  pagedQuadBackend,
  FIRST,
  SECOND,
} from './pagedQuad.fixture.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';

/** The two clusters of the quad; the second without a page when `both` is false, so a cluster the
 *  cache left without one can be told apart. */
const quad = (both: boolean) => pagedQuad([{ corners: FIRST }, { corners: SECOND, paged: both }]);

// The pool holds page WORDS, never a decode of them: what lands in a slot is, byte for byte, the
// `WGP3` object the compiler wrote, and it lands at the word offset the cache gave that cluster.
test('an admitted cluster puts its quantized page bytes at its own pool slot', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const fixture = quad(true);
  const { gpu, backend } = pagedQuadBackend(fixture, events);
  try {
    await backend.prepare();
    backend.render(frontCamera());
    await backend.flush?.();
    const pool = gpu.buffers.find((buffer) => buffer.label === 'WG geometry page cache');
    assert.ok(pool, 'no geometry page pool');
    const declared = events.find((event) => event.phase === 'geometry-pages');
    const slotBytes = Number(declared?.context.slotBytes);
    assert.ok(slotBytes >= fixture.encoded[0].data.byteLength);
    // Which cluster took which slot is the cache's business; that both pages are in the pool
    // whole, each at a slot of its own, is the engine's.
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
    const held = fixture.encoded.map((page, slot) =>
      hex(pool.data.subarray(slot * slotBytes, slot * slotBytes + page.data.byteLength)),
    );
    assert.deepEqual(held.sort(), fixture.encoded.map((page) => hex(page.data)).sort());
  } finally {
    await disposePagedQuad(backend, fixture);
  }
});

// A cluster the cache left without a geometry page is not silently drawn from one: it keeps the
// source float buffers, and the engine says how many clusters are on each side.
test('clusters without a geometry page are counted, not assumed', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const fixture = quad(false);
  const { backend } = pagedQuadBackend(fixture, events);
  try {
    await backend.prepare();
    const split = events.find((event) => event.phase === 'geometry-pages');
    assert.ok(split, 'the engine published no geometry-page count');
    assert.equal(split.context.fromGeometryPage, 1);
    assert.equal(split.context.fromSourceGeometry, 1);
    assert.equal(split.context.clusters, 2);
  } finally {
    await disposePagedQuad(backend, fixture);
  }
});
