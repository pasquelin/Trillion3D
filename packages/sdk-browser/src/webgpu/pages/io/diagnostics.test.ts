import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuDiagnostics } from './diagnostics.ts';

test('a failed WebGPU path is said on the console once per kind, with no channel open', (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const { diagnosticFailure } = createWebgpuDiagnostics(undefined, false);
  diagnosticFailure('visibility-render-failed', new Error('bind group invalid'));
  diagnosticFailure('visibility-render-failed', new Error('bind group invalid'));
  diagnosticFailure('coverage-upload-failed', 'slot refused');
  assert.deepEqual(
    warned.mock.calls.map((call) => call.arguments[0]),
    [
      '[trillion3d] WebGPU visibility-render-failed: bind group invalid',
      '[trillion3d] WebGPU coverage-upload-failed: slot refused',
    ],
  );
});
