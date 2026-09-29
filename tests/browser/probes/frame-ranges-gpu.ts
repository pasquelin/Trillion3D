// A camera cut's `frames` split in ranges cuts on a real GPU as the whole table does (#979): the
// shipped kernels, the shipped resources, a hierarchy deep enough that the descent reuses queue 0
// (levels 3, 6), and the same device underneath both runs — only the binding limit the cut reads
// differs (`frameRangesPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import type { executer } from './frameRangesPage.ts';

declare global {
  var frameRanges: { executer: typeof executer };
}

if (import.meta.main) {
  const ici = dirname(fileURLToPath(import.meta.url));

  test('a table split in three ranges cuts as the whole table, on the GPU', async () => {
    const script = await bundlePage(resolve(ici, 'frameRangesPage.ts'), 'frameRanges');
    const erreursPage: string[] = [];
    const releve = await dansPageWebgpu(
      (argument: Parameters<typeof executer>[0]) => globalThis.frameRanges.executer(argument),
      [0.5, 2, 8],
      { titre: 'Frame ranges', script, erreursPage },
    );
    assert.equal(releve.indisponible, undefined, 'WebGPU must be available');
    assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);
    const { whole, split } = releve as Exclude<typeof releve, { indisponible: string }>;
    assert.equal(whole.ranges, 1);
    assert.equal(split.ranges, 3, 'the table splits in three ranges');
    for (const [k, cut] of whole.cuts.entries()) {
      assert.ok(cut.pageIds.length > 0, `the scene draws at ${cut.pixelError} px`);
      assert.ok(cut.frustumRejected > 0, 'some of it lies outside the view');
      assert.deepEqual(split.cuts[k], cut, `the same cut at ${cut.pixelError} px`);
    }
  });
}
