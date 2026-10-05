// What the timer's sample hands the render-scale controller (`timing.ts`): the image's span, but
// only when every pass that ran was read — a span missing a pass is short, no GPU time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../../../../../tests/kit/gpu/timingDevice.ts';
import { MS } from '../../../gpu/timing/imageTimer.fixture.ts';
import { prepareGpuTiming } from './timing.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

async function observed(pairs: [bigint, bigint][]) {
  const f = fixture(),
    seen: (number | null)[] = [];
  const rt = {
    timing: {} as Record<string, unknown>,
    diag: { traceEnabled: false, engineDiagnostic() {} },
    scale: {
      bounds: { auto: false },
      observe: (gpuMs: number | null) => void seen.push(gpuMs),
    },
    bounce: {},
  } as unknown as WebgpuPagesRuntime;
  prepareGpuTiming(rt, f.device);
  const timing = rt.timing.gpuTiming!;
  const encoder = timing.createEncoder(1);
  for (const _ of pairs) encoder.beginComputePass({ label: 'pass' }).end();
  encoder.finish();
  const read = new BigUint64Array(f.buffers[1].getMappedRange());
  pairs.forEach(([begin, end], i) => read.set([begin * MS, end * MS], i * 2));
  timing.submitted(encoder, { frame: 1 });
  await timing.flush();
  timing.dispose();
  return seen;
}

test('the controller reads the span of an image whose every pass was read', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 7n],
    ]),
    [6],
  );
});

test('an image with a pass whose timestamps cannot be read steps it on the frame interval', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 0n],
    ]),
    [null],
  );
});
