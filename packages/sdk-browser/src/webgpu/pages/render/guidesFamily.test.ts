import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSet } from '../../../guides/guideSet.ts';
import { families } from '../../../host/families.ts';
import { askGuidePass } from './encodeGuides.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

test("a WebGPU world that shows no guide never fetches the guides' code (#1353)", async () => {
  const guides = createGuideSet();
  const rt = {
    gpu: { displayView: {}, depthView: {} },
    context: { guides },
  } as unknown as WebgpuPagesRuntime;
  const noGpu = {} as never;
  askGuidePass(rt, noGpu);
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] }).setVisible(false);
  askGuidePass(rt, noGpu);
  await families.guides.settled();
  assert.equal(families.guides.arrived, false, 'no guide shown: no import started');
});
