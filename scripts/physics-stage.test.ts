import assert from 'node:assert/strict';
import test from 'node:test';
import { profileWindow, workerStep } from '../site/examples/kit/profile.ts';
import { physicsStageReading } from './physics-stage.ts';

const step = (p50: number, p95: number) => ({ p50, p95 });

test('a profile window carries the physics stage and the worker step, p50 and p95 of its samples', () => {
  const window = profileWindow([16, 17], [], { steps: { physicsMs: step(0.4, 0.6) } }, [
    ...Array.from({ length: 19 }, (_, i) => 10 + i),
    40,
  ]);
  assert.deepEqual(window.physicsMs, { p50: 0.4, p95: 0.6 });
  assert.deepEqual(window.workerStepMs, { p50: 20, p95: 40 });
  const unmeasured = profileWindow([16], [], { steps: { physicsMs: step(NaN, NaN) } });
  assert.equal(unmeasured.physicsMs, null);
  assert.equal(unmeasured.workerStepMs, null);
});

test("a frame reads the worker's slowest step of the tick, not its mean, and nothing while off", () => {
  const stats = { stepMs: 9, stepMaxMs: 31 };
  const onFrame = () => {};
  assert.equal(workerStep({ onFrame, physics: { enabled: true, stats } }), 31);
  assert.equal(workerStep({ onFrame, physics: { enabled: false, stats } }), null);
  assert.equal(workerStep({ onFrame }), null);
});

test('the reading takes the median p50 and p95 over the windows, the worst p95 and the fps', () => {
  const windows = [
    profileWindow(Array(60).fill(16), [], { steps: { physicsMs: step(0.4, 0.6) } }, [20]),
    profileWindow(Array(58).fill(17), [], { steps: { physicsMs: step(0.5, 0.9) } }, [22]),
    profileWindow(Array(61).fill(16), [], { steps: { physicsMs: step(0.3, 0.5) } }, []),
  ];
  assert.deepEqual(physicsStageReading(windows), {
    windows: 3,
    fps: { p50: 60, min: 58 },
    physicsMs: { p50: 0.4, p95: 0.6, worstP95: 0.9 },
    workerStepMs: { p50: 20, p95: 20, worstP95: 22 },
  });
  assert.deepEqual(physicsStageReading([]), {
    windows: 0,
    fps: null,
    physicsMs: null,
    workerStepMs: null,
  });
});
