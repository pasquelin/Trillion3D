// What every render-scale control owes its page whatever the rule inside: the targets' size and
// memory cap, the readbacks, a fixed scale, a display that changes, a timer that goes silent
// (`createScaleControl`; the rule's own search is `scaleFit.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleControl } from './scaleControl.ts';
import { fitting, HZ120, HZ60, lowered, simulate } from './scaleFit.fixture.ts';

/** A display at 120 Hz, measured over a few frames. */
function at120(control: ReturnType<typeof createScaleControl>) {
  for (let frame = 0; frame < 4; frame++) control.tick((frame * 1000) / 120);
}

// #831: the targets followed the drawn size on a ladder of eighths, remade at each rung crossed.
test('the targets are made at the bounds maximum, whatever the controller draws', () => {
  const control = createScaleControl({ min: 0.5, max: 1 });
  assert.equal(control.allocated(), 1);
  simulate(control, 300, { gpu: (s) => 40 * s * s });
  assert.equal(control.wanted(), 0.5);
  assert.equal(control.allocated(), 1, 'the controller at its minimum remakes nothing');
  assert.equal(createScaleControl(0.6).allocated(), 0.6, 'a fixed scale is its own');
});

test('a scale the GPU budget refused holds the targets an eighth below it at that view size', () => {
  const control = createScaleControl('auto');
  at120(control);
  const view = '3456x2234';
  assert.equal(control.allocated(view), 1);
  assert.equal(control.capMemory(view), true);
  assert.equal(control.allocated(view), 7 / 8, 'one eighth below the refused one');
  assert.equal(control.capMemory(view), true);
  assert.equal(control.allocated(view), 6 / 8);
  assert.equal(control.allocated('3000x2234'), 1, 'another view is not bound by it');
  assert.equal(control.allocated(view), 6 / 8, 'nor does it lift the cap of the first');
  assert.equal(control.memoryCapped, true);
  assert.ok(control.wanted() <= 6 / 8, 'the scale holds under the cap');
  control.uncapMemory();
  assert.equal(control.allocated(view), 1, 'the room came back: the targets grow again');
  const fixed = createScaleControl({ min: 1, max: 1 });
  assert.equal(fixed.capMemory(), false, 'no eighth below the bounds');
  assert.equal(fixed.allocated(), 1);
});

test('a light page capped by the memory budget stays under the cap, then grows when it lifts', () => {
  const control = createScaleControl('auto'),
    clock = { now: 0, frame: 0 };
  simulate(control, 120, { gpu: () => 2 }, clock);
  assert.equal(control.capMemory('v'), true);
  const { scales } = simulate(control, 240, { gpu: () => 2 }, clock);
  assert.ok(
    scales.every((s) => s <= 7 / 8),
    'never above the cap',
  );
  control.uncapMemory();
  simulate(control, 240, { gpu: () => 2 }, clock);
  assert.equal(control.wanted(), 1);
});

test('the control reads back the measured refresh and the last frame interval', () => {
  const control = createScaleControl('auto');
  assert.equal(control.refreshMs, null, 'no period before the clock finds one');
  control.tick(0);
  assert.equal(control.frameIntervalMs, null, 'one frame holds no interval');
  const clock = { now: 0, frame: 0 };
  simulate(control, 30, { gpu: () => 1 }, clock);
  assert.ok(Math.abs(control.refreshMs! - HZ120) < 1e-6, `${control.refreshMs}`);
  control.tick(clock.now);
  assert.ok(Math.abs(control.frameIntervalMs! - HZ120) < 1e-6, `${control.frameIntervalMs}`);
  control.tick(clock.now + 10_000);
  assert.equal(control.frameIntervalMs, null, 'a pause is no interval');
});

test('a fixed scale ignores the timings, and asking again restarts at the maximum', () => {
  const control = createScaleControl(0.7);
  simulate(control, 120, { gpu: () => 40 });
  assert.equal(control.wanted(), 0.7);
  control.set({ min: 0.5, max: 0.9 });
  assert.deepEqual(control.bounds, { auto: true, min: 0.5, max: 0.9 });
  assert.equal(control.wanted(), 0.9);
});

test('asking another scale restarts the controller, which then measures its own scale', () => {
  const control = createScaleControl('auto'),
    clock = lowered(createScaleControl('auto'), 20);
  simulate(control, 120, { gpu: (s) => 20 * s * s }, clock);
  assert.ok(control.wanted() < 1);
  control.set({ min: 0.5, max: 1 });
  assert.equal(control.wanted(), 1, 'knowing nothing, at the maximum');
  simulate(control, 240, { gpu: (s) => 20 * s * s }, clock);
  assert.ok(control.wanted() < 1, 'and it learns again');
});

// #831: at a fixed scale the budget followed a GPU-bound cadence, and the refresh read it: a
// 120 Hz display at 109 ms frames read 94.76 ms. The display's refresh is what the display shows.
test("frames held many refreshes at a fixed scale leave the display's refresh as it is", () => {
  const control = createScaleControl(1);
  let now = 0;
  for (let frame = 0; frame < 120; frame++) control.tick((now += HZ120));
  // Eleven and thirteen refreshes a frame for three seconds: the thirteen are pauses to the clock.
  for (let frame = 0; frame < 30; frame++) control.tick((now += (frame % 2 ? 13 : 11) * HZ120));
  assert.ok(Math.abs(control.refreshMs! - HZ120) < 1e-6, `${control.refreshMs}`);
});

test('a second tick within one display frame counts no frame', () => {
  const run = (twice: boolean) => {
    const control = createScaleControl('auto'),
      scales: number[] = [];
    let now = 0;
    for (let frame = 0; frame < 120; frame++) {
      control.tick((now += HZ120), true);
      if (twice) control.tick(now, true);
      if (control.measuring) {
        control.hold();
        scales.push(0);
        continue;
      }
      const s = control.wanted(),
        ms = 14 * s * s;
      control.drew(s, true);
      control.observe(ms, s);
      now += (Math.max(1, Math.ceil(ms / HZ120 - 1e-9)) - 1) * HZ120;
      scales.push(s);
    }
    return scales;
  };
  assert.deepEqual(run(true), run(false), 'the same scales as one tick a frame');
});

// A device that holds its display never drops for a search of the refresh, whatever the display.
for (const [hz, refresh] of [
  [120, HZ120],
  [60, HZ60],
] as const)
  test(`a device that holds ${hz} Hz without GPU times keeps the full scale`, () => {
    const control = createScaleControl('auto'),
      { scales } = simulate(control, 600, { gpu: () => 2, timed: false }, undefined, refresh);
    assert.ok(scales.every((s) => s === 0 || s === 1));
    assert.equal(control.wanted(), 1);
  });

test('one late frame at 120 Hz leaves an idle scene at the full scale', () => {
  const control = createScaleControl('auto');
  const clock = { now: 0, frame: 0 };
  simulate(control, 240, { gpu: () => 2 }, clock);
  clock.now += 6;
  const { scales } = simulate(control, 120, { gpu: () => 2 }, clock);
  assert.ok(scales.every((s) => s === 1));
});

// #1343: a period held on its grid never rose: a window moved to 60 Hz kept 8.3 ms.
for (const timed of [true, false])
  test(`a window moved from 120 to 60 Hz goes back to the full scale, ${timed ? 'with' : 'without'} GPU times`, () => {
    const control = createScaleControl('auto'),
      clock = { now: 0, frame: 0 },
      screen = { width: 1728, height: 1117 };
    Object.assign(globalThis, { screen, devicePixelRatio: 2 });
    try {
      simulate(control, 240, { gpu: (s) => 3 * s * s, timed }, clock);
      // Another screen, the new display's refresh to read again.
      Object.assign(screen, { width: 2560, height: 1440 });
      const { shown } = simulate(control, 480, { gpu: (s) => 10 * s * s, timed }, clock, HZ60);
      assert.equal(control.wanted(), 1, 'a 10 ms frame fits 16.7 ms');
      assert.ok(Math.abs(control.refreshMs! - HZ60) < 1e-6, `${control.refreshMs}`);
      assert.ok(shown.slice(-120).every((n) => n === 1));
    } finally {
      Reflect.deleteProperty(globalThis, 'screen');
      Reflect.deleteProperty(globalThis, 'devicePixelRatio');
    }
  });

// #1343: a device that never met its cadence took its slow frames for the display's refresh.
test('without GPU times a device at 16 fps on a 120 Hz display is lowered to the floor', () => {
  const control = createScaleControl('auto'),
    { scales } = simulate(control, 200, { gpu: (s) => 60 * s * s, timed: false });
  assert.equal(control.wanted(), 0.5);
  assert.ok(scales.every((s) => s >= 0.5));
  assert.equal(fitting(60, 0), 0.5);
});
