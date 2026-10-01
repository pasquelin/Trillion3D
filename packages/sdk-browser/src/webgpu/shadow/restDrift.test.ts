// #831: drive-a-car stopped. Its chase camera eases toward the car for ever, by 1e-11 m a frame,
// below a float32 step, the precision the GPU draws the view in: such a view is at rest. With no
// page dirty, the GPU's page work and its static layer pass encode nothing — no GPU pass at all —;
// a real move of the camera runs them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE } from '../../../../sdk-core/src/scene/light-shadow/chaseSun.fixture.ts';
import {
  planFrame,
  sunScene,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { ShadowViewpoint } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { FRESH_LAYER_PASS } from '../../stage/passLabels.ts';
import { frame, passLabels, withStaticLayer } from './freshPass.fixture.ts';

test('a camera easing by less than a float32 step runs no static layer pass; a real move does', () => {
  const { store, plan } = sunScene(),
    calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  plan.gpu.set(true, 0);
  lights.plan.gpu = plan.gpu as unknown as typeof lights.plan.gpu;
  withStaticLayer(lights);
  // The chase camera's ease, `position.lerp(eye, 1 - exp(-5 delta))`, 2e-11 m off its eye.
  const eye = CHASE.position,
    at: [number, number, number] = [eye[0], eye[1], eye[2] + 2e-11];
  const view = (): ShadowViewpoint => ({ ...CHASE, position: [...at] });
  const passes = (frameAt: number) => {
    calls.length = 0;
    planFrame(plan, store, frameAt, view());
    plan.commit();
    encode();
    return passLabels(calls);
  };
  passes(1);
  for (let f = 2; f < 122; f++) {
    for (let axis = 0; axis < 3; axis++)
      at[axis] += (eye[axis] - at[axis]) * (1 - Math.exp(-5 / 60));
    const encoded = passes(f);
    assert.equal(plan.gpu.moved, false, `frame ${f}: the view rests`);
    assert.deepEqual(encoded, [], `frame ${f}: no GPU pass, the static layer's none`);
    assert.equal(plan.counts.invalidatedPages, 0);
  }
  at[0] += 0.5;
  const moved = passes(122);
  assert.equal(plan.gpu.moved, true, 'half a metre moves the view');
  assert.ok(moved.includes(FRESH_LAYER_PASS), 'and the GPU pages run with their static layer');
});
