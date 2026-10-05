// The engine-owned WebGL2 surface keeps its drawing through a resize to the same size, sizes its
// drawing buffer by the declared pixel ratio, recovers a lost context, and owns its context to the
// end: disposing it loses the context and tells no listener removed before — in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { inChrome } from '../kit/onChrome.ts';
import type { execute } from './surfaceLifecyclePage.ts';

const PAGE = resolve(import.meta.dirname, 'surfaceLifecyclePage.ts');

test(
  'the WebGL2 surface resizes, recovers and disposes as it owns its context',
  { timeout: 60_000 },
  async () => {
    const result = await inChrome<Awaited<ReturnType<typeof execute>>>(PAGE, 'execute');
    console.log(JSON.stringify(result));
    assert.deepEqual(result.before, [255, 0, 0, 255]);
    assert.deepEqual(result.afterSameSize, result.before, 'a same-size resize cleared the buffer');
    assert.deepEqual(result.afterResize, [0, 255, 0, 255]);
    assert.deepEqual(result.afterRestore, [0, 0, 255, 255]);
    assert.deepEqual(result.size, {
      width: 16,
      height: 8,
      pixelRatio: 2,
      drawingWidth: 32,
      drawingHeight: 16,
    });
    assert.equal(result.disposed, true);
    assert.equal(result.contextLostAfterDispose, true);
    assert.deepEqual(
      result.events,
      ['lost', 'restored'],
      'dispose must not notify removed listeners',
    );
  },
);
