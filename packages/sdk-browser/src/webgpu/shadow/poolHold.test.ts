// #483 rules 1 and 2: never show an incomplete frame. The shadow pool is granted asynchronously
// (`poolSize.ts`); the frame that first casts a shadow is held until the device answered, so no
// presented image lacks the shadow pass while a light casts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPoolSide } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { asWebgpuDevice } from '../../../../../tests/kit/gpu/webgpuDevice.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { holdWebgpuFrame } from '../frame/hold.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import { sizeShadowPool } from './poolSize.ts';

/** A session whose device refuses every texture past `limit` bytes, and a frame loop reduced to
 *  what `renderWebgpuPages` does around the pool: size it, hold or draw, wait for the next frame.
 *  `shown` records, per presented image, whether the shadow pass could draw in it. */
function frames(limit = Infinity) {
  const rt = settledRt();
  const lights = createWebgpuLightState(shadowPoolSide(300, 150));
  let texture: object | undefined;
  const gpu = asWebgpuDevice({
    createTexture: ({ size }: { size: number[] }) => {
      if (size[0] * size[1] * 4 > limit) gpu.raise('Out of memory');
      return { destroy() {}, createView: () => ({}) };
    },
  });
  lights.shadows = {
    get texture() {
      return texture;
    },
    makePool: (side: number) =>
      gpu.device.createTexture({
        size: [side * 128, side * 128, 1],
        format: 'depth32float',
        usage: 0,
      }),
    sizePool: (_: number, made: object) => void (texture = made),
  } as unknown as NonNullable<typeof lights.shadows>;
  lights.store.add({ ...SUN, id: 'shadow sun' });
  const shown: boolean[] = [],
    said: string[] = [];
  let lastImage = false;
  Object.assign(rt, {
    lights,
    setup: { viewport: [1280, 720] },
    signal: new AbortController().signal,
    diag: {
      engineDiagnostic: (phase: string) => said.push(phase),
      diagnosticFailure: (phase: string) => said.push(phase),
    },
  });
  Object.assign(rt.gpu, {
    device: gpu.device,
    presenter: { present: () => shown.push(lastImage) },
    colorTexture: {},
  });
  const hold = {
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit() {} },
  } as unknown as GPUDevice;
  const frame = async () => {
    sizeShadowPool(rt);
    if (!holdWebgpuFrame(rt, hold)) {
      lastImage = texture !== undefined;
      rt.run.imageRevision++;
      shown.push(lastImage);
    }
    // `pendingWebgpuFrame`: a grant the device still answers for asks the next frame.
    const grant = lights.shadowGrant;
    if (grant && !grant.settled) await grant.done;
  };
  return { rt, shown, said, frame };
}

test('no presented frame lacks the shadow pass while a light casts', async () => {
  const s = frames();
  for (let i = 0; i < 3; i++) await s.frame();
  assert.equal(s.shown[0], true, 'the first presented image already has its shadows');
  assert.ok(s.shown.every(Boolean), `${s.shown}`);
  assert.equal(s.rt.run.frameHeld, false, 'once granted, frames draw again');
});

test('a refused pool is held for, then drawn smaller with its shadows', async () => {
  const s = frames((shadowPoolSide(1280, 720) * 128) ** 2);
  for (let i = 0; i < 2; i++) await s.frame();
  assert.deepEqual(s.said, ['gpu-out-of-memory', 'shadow-pool']);
  assert.deepEqual(s.shown, [true], 'the smaller pool still draws the shadow pass');
});

test('a pool refused at its floor is not waited for forever: shadows-off, then frames draw', async () => {
  const s = frames(0);
  for (let i = 0; i < 2; i++) await s.frame();
  assert.deepEqual(s.said, ['gpu-out-of-memory', 'shadows-off']);
  assert.equal(s.shown.length, 1, 'the frame after the refusal is drawn');
});
