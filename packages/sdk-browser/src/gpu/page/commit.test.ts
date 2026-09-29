// #982 (STR-11): a page goes to its GPU slot straight from its own bytes, and only its last 1-3
// bytes through a zero-padded word — no staging copy of the whole page. Port of the audit's
// `bench_staging.mjs`: develop's upload, frozen below, is the oracle, and every slot must hold the
// same bytes (E0) on random pages at random offsets inside their buffer, and on the edge cases:
// float words NaN, ±0, ±Inf and the largest float, every tail length 0-3, a single byte, and the
// maximal page (the whole slot). An empty page is refused before any slot on both sides (`load.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuPageCache } from './pages.ts';
import { seeded } from '../../../../../site/examples/kit/random.ts';

const PAGE = 4096,
  SLOTS = 3;

/** develop's upload, frozen: the page copied into a staging slot, zero-padded to a word, sent whole. */
function developUpload(gpu: Uint8Array, offset: number, bytes: Uint8Array) {
  const size = bytes.byteLength,
    padded = size + (size % 4 ? 4 - (size % 4) : 0),
    staging = new Uint8Array(PAGE);
  staging.set(bytes);
  if (padded !== size) staging.fill(0, size, padded);
  gpu.set(staging.subarray(0, padded), offset);
}

const random = seeded(982);

/** A page of `size` bytes seen through a view at a random offset of a larger, random buffer. */
function view(size: number) {
  const shift = Math.floor(random() * 7),
    whole = new Uint8Array(size + shift + 3);
  for (let i = 0; i < whole.length; i++) whole[i] = random() * 256;
  return whole.subarray(shift, shift + size);
}

function edgeViews() {
  const floats = new Uint8Array(
    new Float32Array([NaN, -0, 0, Infinity, -Infinity, 3.4028234663852886e38]).buffer,
  );
  const pages = [floats, floats.subarray(1), floats.subarray(0, 23), view(1), view(PAGE)];
  for (let tail = 0; tail < 4; tail++) pages.push(view(PAGE - tail), view(8 + tail));
  return pages;
}

test('each page lands in its GPU slot byte for byte as develop uploaded it (E0)', async () => {
  const pages = edgeViews();
  for (let i = 0; i < 1500; i++) pages.push(view(1 + Math.floor(random() * PAGE)));
  const { device, writes } = fakeDevice({ limits: { maxBufferSize: PAGE * SLOTS } });
  const source = { read: async (key: string) => pages[Number(key)] ?? new Uint8Array(0) };
  const cache = createGpuPageCache(device, source, { pageBytes: PAGE, slots: SLOTS });
  // Both sides start from the same stale slot bytes: a byte the upload leaves is compared too.
  const gpu = new ArrayBuffer(PAGE * SLOTS),
    expected = new Uint8Array(PAGE * SLOTS).fill(0xee);
  new Uint8Array(gpu).fill(0xee);
  for (const [key, bytes] of pages.entries()) {
    const page = await cache.load(String(key));
    replayWrites(gpu, writes);
    developUpload(expected, page.offset, bytes);
    assert.deepEqual(new Uint8Array(gpu), expected, `page ${key} of ${bytes.byteLength} bytes`);
  }
  await assert.rejects(() => cache.load('empty'), /PAGE_SIZE_MISMATCH/);
});
