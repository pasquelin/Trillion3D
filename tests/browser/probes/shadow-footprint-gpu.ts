// The shipped shadow read, run on a device (#1250): a texel outside the footprint its page was
// drawn for reads as a page not drawn and asks for that page; inside, it reads the page as
// drawn — the reads of `footprintReads`, on a sun level and a lamp face (`shadowFootprintPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import type { run } from './shadowFootprintPage.ts';

declare global {
  var shadowFootprint: { run: typeof run };
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));

  test('a texel outside its page’s footprint reads as not drawn and asks for it, on the GPU', async () => {
    const script = await bundlePage(resolve(here, 'shadowFootprintPage.ts'), 'shadowFootprint');
    const result = await dansPageWebgpu(() => globalThis.shadowFootprint.run(), undefined, {
      titre: 'Shadow footprint',
      script,
    });
    assert.equal(result.unavailable, undefined, 'WebGPU must be available');
    const { errors, reads, read, asked } = result as Exclude<
      typeof result,
      { unavailable: string }
    >;
    assert.deepEqual(errors, []);
    assert.ok(reads.some((r) => r.word === 0) && reads.some((r) => r.word !== 0));
    assert.deepEqual(
      read,
      reads.map((r) => r.word),
      'outside: nothing read; inside: the page as drawn',
    );
    assert.deepEqual(
      [...asked].sort((a, b) => a - b),
      reads.map((r) => r.entry).sort((a, b) => a - b),
      'every read asks for its page',
    );
  });
}
