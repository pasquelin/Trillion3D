// #1281: bounced light kept every frame from holding, converged or not, so a still view with it on
// never reached the held frame a capture waits for. Only a series still working keeps it now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unsettledMask, unsettledReasons } from './hold.ts';
import { settledRt } from './hold.fixture.ts';

test('#1281: probes still converging keep the frame drawn, a closed series lets it hold', () => {
  const rt = settledRt();
  type Probes = NonNullable<typeof rt.bounce.probes>;
  rt.bounce.probes = { working: true } as unknown as Probes;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes']);
  rt.bounce.probes = { working: false } as unknown as Probes;
  assert.equal(unsettledMask(rt), 0, 'a converged series is a steady state');
});

test('#1281: probes still being built keep the frame drawn, a refused bounce does not', () => {
  const rt = settledRt();
  rt.bounce.probes = undefined;
  rt.bounce.pending = Promise.resolve();
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes']);
  rt.bounce.reason = 'bounce unavailable';
  assert.equal(unsettledMask(rt), 0, 'a bounce that will never come is a steady state');
});

test('bounce and reflection convergence independently keep the frame awake', () => {
  const rt = settledRt();
  rt.gpu.deferred = { usesContract: true } as typeof rt.gpu.deferred;
  const history = { settled: false };
  rt.gpu.reflection = { active: true, history } as NonNullable<typeof rt.gpu.reflection>;
  const probes = { working: false };
  rt.bounce.probes = probes as NonNullable<typeof rt.bounce.probes>;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['reflections']);
  probes.working = true;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes', 'reflections']);
  history.settled = true;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes']);
  probes.working = false;
  assert.equal(unsettledMask(rt), 0);
});
