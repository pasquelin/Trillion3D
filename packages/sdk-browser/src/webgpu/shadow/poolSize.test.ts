import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPoolSide } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { sizeShadowPool } from './poolSize.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

// A world prepares on a canvas that is not laid out yet — 300 × 150, the HTML default — and takes
// its real drawing buffer at its first frame: the pool follows that frame, once.
test('the shadow pool is sized by the first frame on the canvas, not by the canvas at creation', () => {
  const lights = createWebgpuLightState(shadowPoolSide(300, 150));
  lights.plan.setBudgetMs(3);
  const sized: number[] = [];
  let texture: object | undefined;
  lights.shadows = {
    get texture() {
      return texture;
    },
    sizePool(side: number) {
      texture = {};
      sized.push(side);
    },
  } as unknown as NonNullable<typeof lights.shadows>;
  const viewport: [number, number] = [1280, 720];
  const capture = { capturing: true };
  const rt = {
    lights,
    capture,
    setup: { viewport },
    diag: { engineDiagnostic() {} },
  } as unknown as WebgpuPagesRuntime;
  sizeShadowPool(rt);
  assert.deepEqual(sized, [], "a capture's temporary size sizes nothing");
  capture.capturing = false;
  lights.store.add({ ...SUN, castsShadow: false });
  sizeShadowPool(rt);
  assert.deepEqual(sized, [], 'no light casts a shadow: no pool');
  lights.store.add({ ...SUN, id: 'shadow sun' });
  sizeShadowPool(rt);
  assert.deepEqual(sized, [51]);
  assert.equal(lights.plan.pool.side, 51, 'the plan follows the atlas');
  assert.equal(lights.plan.budget.budgetMs, 3, "the host's budget is kept");
  viewport[0] = 3840;
  viewport[1] = 2160;
  sizeShadowPool(rt);
  assert.deepEqual(sized, [51], 'a later resize leaves the budget where it is');
});
