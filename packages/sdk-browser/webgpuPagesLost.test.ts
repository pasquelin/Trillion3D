import test from 'node:test';
import assert from 'node:assert/strict';
import { markWebgpuLost } from './webgpuPagesLost.ts';

function runtime() {
  const announced: Array<{ phase: string; details: Record<string, unknown> }> = [];
  const rt = {
    run: {
      lost: false,
      frameHeld: true,
    },
    gpu: { presenter: { canvas: {}, disposed: 0, dispose() {} } },
    diag: {
      engineDiagnostic: (phase: string, _message: string, details: Record<string, unknown>) => {
        announced.push({ phase, details });
      },
    },
  };
  rt.gpu.presenter.dispose = () => {
    rt.gpu.presenter.disposed++;
  };
  return { rt, announced, presenter: rt.gpu.presenter };
}

test('a lost device withdraws the surface and the held frame, then announces it once', () => {
  const { rt, announced, presenter } = runtime();
  rt.diag.engineDiagnostic = (phase, message, details) => {
    // Announced after the withdrawal: the host already finds nothing to present.
    assert.equal(rt.gpu.presenter, undefined, 'the canvas is withdrawn before the announcement');
    announced.push({ phase, details });
  };
  assert.equal(markWebgpuLost(rt as never, { reason: 'destroyed', message: 'gone' }), true);
  assert.equal(rt.run.lost, true);
  assert.equal(presenter.disposed, 1, 'the presenter is disposed, which blanks its canvas');
  assert.equal(rt.run.frameHeld, false, 'no frame of a lost device is still held');
  assert.deepEqual(announced, [
    {
      phase: 'gpu-device-lost',
      details: { code: 'WEBGPU_LOST', reason: 'destroyed', message: 'gone' },
    },
  ]);
  assert.equal(markWebgpuLost(rt as never, { reason: 'residency', message: 'again' }), false);
  assert.equal(announced.length, 1, 'a second cause announces nothing');
  assert.equal(presenter.disposed, 1);
});

test('a dispose withdraws the same things without announcing a loss', () => {
  const { rt, announced, presenter } = runtime();
  assert.equal(markWebgpuLost(rt as never), true);
  assert.equal(rt.gpu.presenter, undefined);
  assert.equal(presenter.disposed, 1);
  assert.deepEqual(announced, []);
});
