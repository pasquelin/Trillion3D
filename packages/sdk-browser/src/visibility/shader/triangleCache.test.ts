// The resolve reads a triangle two pixels or more read from the frame cache instead of decoding it
// (`shadeCacheWgsl.ts`). On a frame of quantized, source-buffer, deformed and sprite rows
// (`triangleCache.fixture.ts`), the shipped passes run — or none —, then
// every pixel's `pixelTriangle` and `rowFrame` are asked for the bits its own decode and
// composition give it: what the resolve reads is what it computed without the cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheRun } from './triangleCache.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { SHADE_TRIS_SHADER } from './shadeCacheWgsl.ts';

const WIDTH = 24,
  HEIGHT = 16;
const { NO_SLOT, SHADE_CACHE_END } = wgslConstants(SHADE_TRIS_SHADER);
type Run = ReturnType<typeof cacheRun>;
type Triangle = Record<string, number[]>;
type Frame = { invT: { adj: number[][]; scale: number; regular: boolean }; positive: boolean };
/** A frame's floats as their bits — its adjugate's three columns (\`Mat3\`), its scale — and flags. */
const bits = (t: Triangle) =>
  [...new Uint32Array(new Float32Array(Object.values(t).flat()).buffer)].join();
const frameBits = ({ invT, positive }: Frame) =>
  [
    bits({ adj: [0, 1, 2].flatMap((c) => invT.adj[c]), scale: [invT.scale] }),
    invT.regular,
    positive,
  ].join();

/** The pixels of each triangle of the table's rows, by identifier; past its page included. */
function reads(run: Run) {
  const count = new Map<number, number>();
  for (const line of run.vis)
    for (const id of line)
      if (id >= 256 && (id >> 8) - 1 < run.pages.length) count.set(id, (count.get(id) ?? 0) + 1);
  return count;
}
const valid = (run: Run, id: number) => (id & 0xff) * 3 + 2 < run.pages[(id >> 8) - 1].indexCount;
const slot = (run: Run, id: number) => run.reads.cachedSlot((id >> 8) - 1, id & 0xff) as number;

/** Every pixel the resolve shades reads the frame it composes and the bits its decode gives. */
function assertPixelsRead(run: Run) {
  let cached = 0;
  for (const id of reads(run).keys()) {
    if (!valid(run, id)) continue;
    const row = (id >> 8) - 1,
      page = run.pages[row];
    const own = run.exact.composeRowFrame(page.world) as Frame;
    assert.equal(frameBits(run.reads.rowFrame(row, page.world) as Frame), frameBits(own));
    const read = run.reads.pixelTriangle(row, page, id & 0xff) as Triangle,
      decoded = run.exact.decodeTriangle(page, id & 0xff, own.invT) as Triangle;
    assert.equal(bits(read), bits(decoded), `row ${row} triangle ${id & 0xff}`);
    if (slot(run, id) !== NO_SLOT) cached++;
  }
  return cached;
}

const run = cacheRun(WIDTH, HEIGHT);

test('each triangle two pixels read is cached, every pixel reads its decode bit for bit', () => {
  run.frame(1 << 20);
  const count = reads(run);
  for (const [id, pixels] of count)
    assert.equal(slot(run, id) !== NO_SLOT, pixels >= 2, `${id >> 8}:${id & 0xff} read ${pixels}`);
  // The slots are the cursor's, one per triangle, none twice.
  const slots = [...count.keys()].map((id) => slot(run, id)).filter((s) => s !== NO_SLOT);
  assert.equal(new Set(slots).size, slots.length);
  assert.deepEqual(
    slots.toSorted((a, b) => a - b),
    slots.map((_, i) => i),
  );
  assert.equal(run.cache[0], slots.length);
  // The fitting slots end where the cursor stopped; the dispatch covers them, a group no more.
  const groups = Math.ceil(slots.length / 64);
  assert.deepEqual(
    [run.cache[SHADE_CACHE_END], ...run.work],
    [slots.length, Math.min(groups, 2), Math.ceil(groups / 2), 1],
  );
  assert.ok(assertPixelsRead(run) > 0);
  // The frame holds every case: big, lone, past its page, every row cached.
  assert.ok([...count.values()].some((n) => n === 1) && [...count.values()].some((n) => n > 50));
  assert.ok([...count.keys()].some((id) => !valid(run, id)));
  // Every row — quantized, source, deformed in either pool, sprite — has triangles of both kinds.
  for (let row = 0; row < run.pages.length; row++) {
    const own = [...count.keys()].filter((id) => (id >> 8) - 1 === row && valid(run, id));
    assert.ok(
      own.some((id) => slot(run, id) !== NO_SLOT) && own.some((id) => slot(run, id) === NO_SLOT),
      `${row}`,
    );
  }
});

test('a row past the capacity is decoded by its pixels, the rows before still cached', () => {
  run.frame(1 << 20);
  const needed = run.cache[0];
  // Exactly the capacity it needs: every row fits.
  run.frame(needed);
  const twice = [...reads(run)].filter(([, pixels]) => pixels >= 2);
  assert.ok(twice.every(([id]) => slot(run, id) !== NO_SLOT));
  run.frame(needed - 1);
  const cached = [...reads(run).keys()].filter((id) => slot(run, id) !== NO_SLOT);
  const rows = new Set(cached.map((id) => id >> 8));
  assert.ok(rows.size > 0 && rows.size < run.pages.length, 'some rows fit, one does not');
  for (const id of cached) assert.ok(slot(run, id) < needed - 1);
  assertPixelsRead(run);
});

test('without the cache every pixel composes and decodes its own (trillion3dShadeNoCache)', () => {
  const run = cacheRun(WIDTH, HEIGHT, true);
  run.frame(1 << 20);
  assert.ok([...reads(run).keys()].every((id) => slot(run, id) === NO_SLOT));
  assert.equal(assertPixelsRead(run), 0);
});
