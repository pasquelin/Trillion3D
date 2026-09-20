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
  const state = { samplePixelError: 0, requested: 0, view: 0 };
  const run = {
    budgetPixelError: 0,
    budgetOverflowError: -1,
    budgetOverflowView: -1,
    coverageBudgetLimited: false,
    coverageBudgetEvent: undefined as Record<string, unknown> | undefined,
    gpuSelection: { peek: () => ({ uniforms: { pixelError: state.samplePixelError } }) },
    gate: { revisions: state },
  };
  const rt = {
    run,
    setup: { slots },
    services: {
      bootstrapState: { ready: true },
      residencySets: {
        get requestedCount() {
          return state.requested;
        },
        get keepCount() {
          return state.requested;
        },
      },
    },
  } as unknown as WebgpuPagesRuntime;
  /** One frame: the sample at `sampled` asked for `requested` pages; the frame asks `pixelError`. */
  const frame = (sampled: number, requested: number, pixelError = 0) => {
    state.samplePixelError = sampled;
    state.requested = requested;
    admitGpuCut(rt, pixelError, Math.max(pixelError, run.budgetPixelError));
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

test('the relax share is the fraction of the slots under which the floor lowers', () => {
  const { state, frame } = mount(100);
  frame(0, 250);
  frame(1, 120);
  state.view = 1;
  const atShare = Math.floor(100 * BUDGET_RELAX_RATIO);
  assert.equal(frame(2, atShare), 2, 'at the share itself the floor holds');
  assert.equal(frame(2, atShare - 1), 1, 'under it, the next finer rung is asked for');
});
