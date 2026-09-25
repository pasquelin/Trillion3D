import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitGpuCut } from './gpuCutAdmission.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { createWebgpuBudgetState } from '../../residency/budgetState.ts';

/** A runtime reduced to what admission reads: the pool, the sample's threshold, the counts. */
function mount(slots: number) {
  const state = { samplePixelError: 0, requested: 0, kept: 0 };
  const run = {
    ...createWebgpuBudgetState(),
    gpuSelection: { peek: () => ({ uniforms: { pixelError: state.samplePixelError } }) },
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
          return state.kept;
        },
      },
    },
  } as unknown as WebgpuPagesRuntime;
  /** One frame: the sample at `sampled` asked for `requested` pages, and holds `kept`. */
  const frame = (sampled: number, requested: number, kept = requested) => {
    state.samplePixelError = sampled;
    state.requested = requested;
    state.kept = kept;
    admitGpuCut(rt);
  };
  return { run, frame };
}

test('an overflowing cut is said once, and never raises the threshold', () => {
  const { run, frame } = mount(100);
  frame(0, 250);
  assert.equal(run.coverageBudgetLimited, true);
  assert.equal(run.coverageBudgetEvent?.limited, true);
  assert.equal(run.coverageBudgetEvent?.pixelError, 0, 'the sample was cut at the host threshold');
  assert.deepEqual(
    Object.keys(run).filter((key) => /pixelError/i.test(key)),
    [],
    'the runtime carries no threshold of its own',
  );
  run.coverageBudgetEvent = undefined;
  frame(0, 250);
  assert.equal(run.coverageBudgetEvent, undefined, 'an unchanged verdict is not said again');
});

test('pages still drawn count against the slots as the requested ones do', () => {
  const { run, frame } = mount(100);
  frame(0, 60, 130);
  assert.equal(run.coverageBudgetLimited, true);
  frame(0, 60, 60);
  assert.equal(run.coverageBudgetLimited, false);
  assert.equal(run.coverageBudgetEvent?.limited, false);
});
