// #1336: the WebGPU card pipelines are checked where the session prepares. Refused by the device —
// in its validation scope, or by a pipeline compiled off the thread —, the failure is told once and
// the answer is false, so the session keeps no impostor code and every root its clusters, never
// setting an invalid pipeline that would lose each image's commands. Fails without the check: the
// pipelines were made unchecked at the first plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../impostor/lent.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { cardPipelines, prepareImpostorPipelines } from './pipelines.ts';

const refusals: Record<string, Partial<GPUDevice>> = {
  'its validation scope': {
    pushErrorScope: () => {},
    popErrorScope: async () => ({ message: 'card_fs: unresolved identifier' }) as GPUError,
  },
  'a pipeline compiled off the thread': {
    createRenderPipelineAsync: async () => {
      throw new Error('card_vis_hiz_fs: link failed');
    },
  },
};

for (const [by, refusal] of Object.entries(refusals))
  test(`card pipelines refused by ${by} are told once and leave the session without cards`, async () => {
    const { device } = fakeDevice();
    const told: string[] = [];
    const onFailure = (phase: string) => void told.push(phase);
    assert.equal(await prepareImpostorPipelines(device, onFailure), true, 'checked and kept');
    assert.ok(cardPipelines(device).visPipeline(true), 'both visibility stages compiled');
    const refusing = Object.assign(Object.create(device) as GPUDevice, refusal);
    assert.equal(await prepareImpostorPipelines(refusing, onFailure), false);
    assert.deepEqual(told, ['impostor-card-program-failed'], 'told once');
    assert.equal(cardPipelines(refusing), undefined, 'a refused device keeps no pipelines');
  });
