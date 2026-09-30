// #1275: on a real device, the pages the per-pixel demand marks are the pages the shading reads —
// every frame of a turning astrolabe and of a ring of moving lamps (`shadowDemandScenes.ts`). The
// demand's own functions and the shading's own read run on the device (`shadowDemandReadsPage.ts`):
// with every marked page drawn in the frame, as the GPU draws what it maps, the read asks for no
// page the demand did not mark, and the demand marks no page the read does not ask for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import type { run } from './shadowDemandReadsPage.ts';

declare global {
  var shadowDemandReads: { run: typeof run };
}

const here = dirname(fileURLToPath(import.meta.url));

if (import.meta.main) {
  test('the pages marked are the pages read, on a turning astrolabe and a ring of moving lamps', async () => {
    const script = await bundlePage(resolve(here, 'shadowDemandReadsPage.ts'), 'shadowDemandReads');
    const result = await dansPageWebgpu(() => globalThis.shadowDemandReads.run(), undefined, {
      titre: 'Shadow demand reads',
      script,
    });
    assert.equal(result.unavailable, undefined, 'WebGPU must be available');
    const { errors, scenes } = result as Exclude<typeof result, { unavailable: string }>;
    assert.deepEqual(errors, []);
    for (const { scene, frames } of scenes) {
      console.log(JSON.stringify({ scene, marked: frames.map((frame) => frame.marked) }));
      frames.forEach(({ marked, unmarked, unread }, frame) => {
        assert.ok(marked > 0, `${scene}, frame ${frame}: pages marked`);
        assert.deepEqual(unmarked, [], `${scene}, frame ${frame}: pages read and not marked`);
        assert.deepEqual(unread, [], `${scene}, frame ${frame}: pages marked and not read`);
      });
    }
  });
}
