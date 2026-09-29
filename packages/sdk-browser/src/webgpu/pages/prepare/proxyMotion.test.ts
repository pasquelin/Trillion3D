import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLightingProxies, syncPageProxy } from './proxyMotion.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

test('borrowed far shadows follow off-move-on and late loads without duplicate epoch work', () => {
  let observed = -1,
    updates = 0,
    refreshes = 0;
  const matrix = new Float64Array(16);
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
  const moving = {
    sync(worldOf: (rank: number) => ArrayLike<number> | undefined) {
      updates++;
      observed = worldOf(-1)![12];
      return true;
    },
  };
  const rt = {
    setup: {
      source: { traverse() {} },
      worlds: { of: () => ({ elements: matrix }), refresh: () => refreshes++ },
    },
    run: { gate: { revisions: { scene: 1 } } },
    bounce: { wanted: false, probes: moving },
    sunFar: { borrowed: true, gpu: { proxy: moving } },
  } as unknown as WebgpuPagesRuntime;
  syncLightingProxies(rt);
  matrix[12] = 40;
  rt.run.gate.revisions.scene++;
  syncLightingProxies(rt);
  assert.equal(observed, 40, 'off bounce still updates the borrowed shadow geometry');
  rt.bounce.wanted = true;
  syncLightingProxies(rt);
  assert.equal(updates, 2, 'toggle alone does not repeat geometry work');
  const late = { sync: moving.sync };
  matrix[12] = 90;
  syncPageProxy(rt, late, true);
  assert.equal(refreshes, 1);
  assert.equal(observed, 90, 'late arrival sees current host world, not its cooked pose');
});

test('a moving proxy syncs once on the first frame without a scene write, to settle', () => {
  let syncs = 0;
  const proxy = {
    dynamic: true,
    sync: () => (syncs++, true),
  };
  const rt = {
    setup: { source: { traverse() {} }, worlds: { of: () => undefined } },
    run: { frame: 1, gate: { revisions: { scene: 1 } } },
  } as unknown as WebgpuPagesRuntime;
  syncPageProxy(rt, proxy);
  syncPageProxy(rt, proxy);
  assert.equal(syncs, 1, 'a second sync in the frame that moved does not settle it');
  rt.run.frame++;
  syncPageProxy(rt, proxy);
  assert.equal(syncs, 2, 'the still frame reaches the moving proxy');
  rt.run.frame++;
  syncPageProxy(rt, proxy);
  assert.equal(syncs, 2, 'one settling try per still epoch, even when it cannot settle');
  proxy.dynamic = false;
  rt.run.gate.revisions.scene++;
  syncPageProxy(rt, proxy);
  rt.run.frame++;
  syncPageProxy(rt, proxy);
  assert.equal(syncs, 3, 'a still proxy syncs once per scene write');
});
