import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  admitGpuCut,
  BUDGET_RELAX_RATIO,
  MIN_BUDGET_PIXEL_ERROR,
} from './webgpuPagesGpuCutAdmission.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** A runtime reduced to what admission reads: the pool, the sample's threshold, the counts. */
function mount(slots: number) {
  const state = { samplePixelError: 0, requested: 0, kept: 0, view: 0, slots };
  const run = {
    budgetPixelError: 0,
    budgetOverflowError: -1,
    budgetOverflowView: -1,
    budgetOverflowSlots: -1,
    coverageBudgetLimited: false,
    coverageBudgetEvent: undefined as Record<string, unknown> | undefined,
    gpuSelection: { peek: () => ({ uniforms: { pixelError: state.samplePixelError } }) },
    gate: { revisions: state },
  };
  const rt = {
    run,
    setup: {
      get slots() {
        return state.slots;
      },
    },
    services: {
      bootstrapState: { ready: true },
      residencySets: {
        get requestedCount() {
          return state.requested;
        },
        get keepCount() {
          return state.kept;
        },
      },
    },
  } as unknown as WebgpuPagesRuntime;
  /** One frame: the sample at `sampled` asked for `requested` pages (and holds `kept` with what is
   *  still drawn); the frame asks `pixelError`. */
  const frame = (sampled: number, requested: number, pixelError = 0, kept = requested) => {
    state.samplePixelError = sampled;
    state.requested = requested;
    state.kept = kept;
    admitGpuCut(rt, pixelError);
    return run.budgetPixelError;
  };
  return { run, state, frame };
}

test('the budget steps only on a sample cut at the threshold the frame asks for', () => {
  const { run, frame } = mount(100);
  assert.equal(frame(0, 250), 1, 'an overflow at the host threshold coarsens to the first rung');
  assert.equal(run.coverageBudgetLimited, true);
  assert.equal(run.coverageBudgetEvent?.limited, true);
  // The next frames still read the sample cut at 0: the count answers a threshold no longer asked.
  assert.equal(frame(0, 250), 1, 'no second doubling on the same sample');
  assert.equal(frame(0, 250), 1);
  assert.equal(frame(1, 120), 2, 'the sample at 1 overflows: one more rung');
  assert.equal(frame(2, 80), 2, 'the sample at 2 fits above the relax share: the floor holds');
  assert.equal(run.coverageBudgetLimited, false);
  assert.equal(run.coverageBudgetEvent?.limited, false);
});

test('a threshold that overflowed this view is not asked for again while the view stays', () => {
  const { run, state, frame } = mount(100);
  frame(0, 250);
  frame(1, 120);
  // 2 fits with room to spare — but 1 overflowed this very view: relaxing would only replay it.
  assert.equal(frame(2, 50), 2);
  assert.equal(frame(2, 50), 2, 'and stays there frame after frame');
  assert.equal(run.budgetOverflowError, 1);
  // The view moved: 1 may fit from there, so it is asked for again.
  state.view = 1;
  assert.equal(frame(2, 50), 1);
  assert.equal(run.budgetOverflowError, -1);
  // It overflows again, and this time the pool grows: the wider pool may fit it too.
  frame(1, 120);
  assert.equal(frame(2, 50), 2, 'held on the overflow just seen');
  state.slots = 300;
  assert.equal(frame(2, 50), 1, 'a resized pool forgets what overflowed the previous one');
});

test('relaxing walks the ladder back down to the host threshold, never below it', () => {
  const { state, frame } = mount(100);
  frame(0.5, 250, 0.5);
  frame(1, 150, 0.5);
  assert.equal(frame(2, 120, 0.5), 4);
  // Another view, where every rung fits with room to spare.
  state.view = 1;
  // 4 → 2 → 1 → 0: the first rung is twice the host threshold, and below it the floor is given up.
  assert.equal(frame(4, 40, 0.5), 2);
  assert.equal(frame(2, 40, 0.5), 1);
  assert.equal(frame(1, 40, 0.5), 0);
  assert.equal(frame(0.5, 40, 0.5), 0);
});

test('under a host threshold of zero the ladder goes below one pixel, down to its finest rung', () => {
  const { state, frame } = mount(100);
  frame(0, 250);
  state.view = 1;
  assert.equal(frame(1, 40), 0.5);
  assert.equal(frame(0.5, 40), 0.25);
  assert.equal(frame(0.25, 40), MIN_BUDGET_PIXEL_ERROR);
  assert.equal(frame(MIN_BUDGET_PIXEL_ERROR, 40), 0, 'below the finest rung, the host threshold');
  assert.equal(frame(0, 250), 1, 'and an overflow there climbs back to one pixel');
});

test('a floor the host threshold has passed is given up, and an overflow doubles what was drawn', () => {
  const { run, frame } = mount(100);
  frame(0, 250);
  frame(1, 120);
  assert.equal(run.budgetPixelError, 2);
  // The host now asks for 3 px: the floor of 2 decides nothing and reads 0, even without room.
  assert.equal(frame(3, 90, 3), 0);
  // An overflow at 10 px climbs from 10, not from a stale floor: one doubling per sample.
  assert.equal(frame(10, 250, 10), 20);
  assert.equal(frame(10, 250, 10), 20, 'the sample at 10 has been answered');
  assert.equal(frame(20, 250, 10), 40);
});

test('an adaptive host threshold that moves every frame still gets its verdict', () => {
  const { run, frame } = mount(100);
  // No floor rules: the sample cut at 0.8 overflows while the frame already asks 0.9.
  assert.equal(frame(0.8, 250, 0.9), 1.6, 'coarsened from what the sample was drawn at');
  assert.equal(run.coverageBudgetLimited, true);
  // A floor rules: only a sample at that floor answers, whatever the host asks meanwhile.
  assert.equal(frame(0.9, 250, 1.1), 1.6, 'the sample at 0.9 is not the floor: no step');
  assert.equal(frame(1.6, 90, 1.2), 1.6);
  assert.equal(run.coverageBudgetLimited, false);
});

test('pages still drawn from the previous cut coarsen once more but are not memorised', () => {
  const { run, frame } = mount(100);
  frame(0, 250);
  // The sample at 1 fits (60 pages) but the image still holds the old fine cut: the union overflows.
  assert.equal(frame(1, 60, 0, 130), 2, 'the transient coarsens once more');
  assert.equal(run.budgetOverflowError, 0, 'only the requested overflow at 0 is remembered');
  // The old cut has drained: 1 fits with room, and nothing forbids coming back to it.
  assert.equal(frame(2, 50), 1);
  assert.equal(frame(1, 80), 1, 'and it holds there');
});

test('the relax share is the fraction of the slots under which the floor lowers', () => {
  const { state, frame } = mount(100);
  frame(0, 250);
  frame(1, 120);
  state.view = 1;
  const atShare = Math.floor(100 * BUDGET_RELAX_RATIO);
  assert.equal(frame(2, atShare), 2, 'at the share itself the floor holds');
  assert.equal(frame(2, atShare - 1), 1, 'under it, the next finer rung is asked for');
});
