import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleControl } from './scaleControl.ts';

const HZ120 = 1000 / 120,
  HZ60 = 1000 / 60;

/**
 * A device drawing moving images of `cost(s)` ms at scale `s` on a display refreshing every
 * `vsync()` ms: each frame begins at the first refresh after the last image is done, as rAF does.
 * `timed`: the GPU time of each image arrives. Returns the frame intervals.
 */
function run(
  control: ReturnType<typeof createScaleControl>,
  frames: number,
  vsync: () => number,
  cost: (s: number) => number,
  timed: boolean,
  clock = { now: 0 },
) {
  const gaps: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const s = control.wanted(),
      ms = cost(s),
      period = vsync(),
      gap = Math.max(1, Math.ceil(ms / period - 1e-9)) * period;
    control.drew(s, true);
    control.tick((clock.now += gap), timed);
    if (timed) control.observe(ms, s);
    gaps.push(gap);
  }
  return gaps;
}

// #1343: the shortest interval was the period, so a frame 6 ms late set a 2.5 ms budget.
test('one late frame at 120 Hz leaves an idle scene at the full scale', () => {
  const control = createScaleControl('auto');
  let now = 0;
  for (let frame = 0; frame < 240; frame++) {
    control.drew(control.wanted(), true);
    control.tick((now += HZ120) + (frame === 60 ? 6 : 0), true);
    control.observe(2, control.wanted());
    assert.equal(control.wanted(), 1, `frame ${frame}`);
  }
});

// #1343: a period held on its grid never rose: a window moved to 60 Hz kept 8.3 ms.
test('a window moved from 120 to 60 Hz goes back to the full scale, with GPU times', () => {
  const control = createScaleControl('auto'),
    clock = { now: 0 };
  let vsync = HZ120;
  run(
    control,
    240,
    () => vsync,
    (s) => 3 * s * s,
    true,
    clock,
  );
  vsync = HZ60;
  run(
    control,
    360,
    () => vsync,
    (s) => 10 * s * s,
    true,
    clock,
  );
  assert.equal(control.wanted(), 1, 'a 10 ms frame fits 16.7 ms');
});

test('a window moved from 120 to 60 Hz goes back to the full scale, without GPU times', () => {
  const control = createScaleControl('auto'),
    clock = { now: 0 };
  let vsync = HZ120;
  run(
    control,
    240,
    () => vsync,
    () => 2,
    false,
    clock,
  );
  vsync = HZ60;
  run(
    control,
    360,
    () => vsync,
    () => 2,
    false,
    clock,
  );
  assert.equal(control.wanted(), 1, 'an idle scene at 60 Hz');
});

// #1343: frames every two refreshes from the first frame read as a 60 Hz display, forever.
test('a steady 60 fps on a 120 Hz display without GPU times probes and finds 120 Hz', () => {
  const control = createScaleControl('auto');
  const gaps = run(
    control,
    600,
    () => HZ120,
    (s) => 12 * s * s,
    false,
  ).slice(300);
  assert.ok(control.wanted() < 1);
  const met = gaps.filter((gap) => gap < 1.5 * HZ120).length;
  assert.ok(met >= 0.9 * gaps.length, `${met} of ${gaps.length} frames at 120 fps`);
});

test('a steady cadence the display sets is probed once, then left at the full scale', () => {
  const control = createScaleControl('auto');
  run(
    control,
    60,
    () => HZ60,
    () => 2,
    false,
  );
  const gaps = run(
    control,
    300,
    () => HZ60,
    () => 2,
    false,
  );
  assert.equal(control.wanted(), 1);
  assert.ok(gaps.every((gap) => Math.abs(gap - HZ60) < 1e-9));
});

test('another screen resets the clock: a move to 60 Hz drops nothing', () => {
  const screen = { width: 1728, height: 1117 };
  Object.assign(globalThis, { screen, devicePixelRatio: 2 });
  try {
    const control = createScaleControl('auto'),
      clock = { now: 0 };
    let vsync = HZ120;
    run(
      control,
      240,
      () => vsync,
      () => 2,
      false,
      clock,
    );
    Object.assign(screen, { width: 2560, height: 1440 });
    vsync = HZ60;
    // The frames before the new period's probe.
    for (const gap of run(
      control,
      30,
      () => vsync,
      () => 2,
      false,
      clock,
    ))
      assert.equal(control.wanted(), 1, `${gap}`);
  } finally {
    Reflect.deleteProperty(globalThis, 'screen');
    Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  }
});
