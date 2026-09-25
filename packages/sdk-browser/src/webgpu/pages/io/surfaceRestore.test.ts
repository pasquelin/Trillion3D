import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreMainView, type SavedView } from './surfaceRestore.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

test('the main view a capture restores is not held: the view is replaced once it is back', async () => {
  const calls: string[] = [];
  const capture = { capturing: true, surfaceRenderAllowed: true };
  const rt = {
    run: {
      lost: true,
      motion: {},
      temporalHizState: {},
      gate: { viewReplaced: () => calls.push(capture.capturing ? 'during' : 'after') },
    },
    gpu: {},
    capture,
    context: {},
    diag: {},
    setup: { viewport: [0, 0] },
  } as unknown as WebgpuPagesRuntime;
  const saved = { main: {}, size: [32, 16], diagnostic: 'beauty', motion: {} } as SavedView;
  await restoreMainView(rt, {} as GPUDevice, saved);
  assert.deepEqual(calls, ['after'], 'the image drawn without the chain breaks the next hold');
  assert.equal(capture.capturing, false);
});
