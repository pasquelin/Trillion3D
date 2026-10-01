// #1336: the WebGPU card pipelines are checked where the session prepares. Refused by the device,
// the failure is told once and the answer is false, so the session keeps no impostor code and every
// root its clusters, never setting an invalid pipeline that would lose each image's commands.
// Fails without the check: the pipelines were made unchecked at the first plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../impostor/lent.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { cardPipelines, prepareImpostorPipelines } from './pipelines.ts';

test('card pipelines the device refuses are told once and leave the session without cards', async () => {
  const { device } = fakeDevice();
  const told: string[] = [];
  const onFailure = (phase: string) => void told.push(phase);
  assert.equal(await prepareImpostorPipelines(device, onFailure), true, 'checked and kept');
  const kept = cardPipelines(device);
  // The device's scope now reports the card shader's error.
  const refusing = Object.assign(Object.create(device) as GPUDevice, {
    popErrorScope: async () => ({ message: 'card_fs: unresolved identifier' }),
    pushErrorScope: () => {},
  });
  assert.equal(await prepareImpostorPipelines(refusing, onFailure), false);
  assert.deepEqual(told, ['impostor-card-program-failed'], 'told once');
  assert.equal(cardPipelines(device), kept, 'a checked device keeps its pipelines');
});
