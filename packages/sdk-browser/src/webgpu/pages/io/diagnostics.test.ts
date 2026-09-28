import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuDiagnostics } from './diagnostics.ts';
import { sendEngineDiagnostic } from '../../../diagnostic/engineDiagnostic.ts';

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

test('an engine diagnostic is versioned, and an observer that throws does not reach the engine', () => {
  const seen: unknown[] = [];
  const observer = (diagnostic: { context?: Record<string, unknown> }) => {
    seen.push(diagnostic.context?.pipelineVersion);
    throw new Error('observer failure');
  };
  assert.doesNotThrow(() =>
    sendEngineDiagnostic(observer, 'memory-budgets', 'Memory pools set', {}),
  );
  assert.deepEqual(seen, [1]);
});

// #990: what a disposed session's pending work throws — a program compiled, an upload on the
// released device — is its cancellation: said nowhere. The same failure under a live session is.
test('a failure under an aborted session is said nowhere; under a live one it is', (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const said: string[] = [];
  const session = new AbortController();
  const { diagnosticFailure } = createWebgpuDiagnostics(
    ({ phase }) => void said.push(phase),
    false,
    session.signal,
  );
  diagnosticFailure('direct-lighting-program-failed', new Error('device lost'));
  session.abort();
  const released = new DOMException('Session @t3d:3 released the device', 'AbortError');
  diagnosticFailure('shadow-static-layer-unavailable', released);
  diagnosticFailure('coverage-upload-failed', new Error('WEBGPU_LOST'));
  assert.deepEqual(said, ['direct-lighting-program-failed']);
  assert.equal(warned.mock.callCount(), 1);
});
