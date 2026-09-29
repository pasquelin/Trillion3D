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
