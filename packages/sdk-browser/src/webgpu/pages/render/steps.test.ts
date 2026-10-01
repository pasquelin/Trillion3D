import assert from 'node:assert/strict';
import test from 'node:test';
import { logFirstCpuRenderPath } from './steps.ts';

test('first render configuration reaches diagnostics once without leaking into a page console', (t) => {
  const logged = t.mock.method(console, 'info', () => {});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'window', previous)
      : Reflect.deleteProperty(globalThis, 'window'),
  );
  const heard: unknown[][] = [];
  const rt = {
    run: { clearColor: 0x123456, shown: [1, 2], drawn: [1], renderPathLogged: false },
    vis: { visEnabled: true, visPipelineBack: {}, materialDepthPipeline: {}, visView: {} },
    gpu: { targetSize: [640, 480] },
    diag: { engineDiagnostic: (...args: unknown[]) => heard.push(args) },
  };
  logFirstCpuRenderPath(rt as never);
  logFirstCpuRenderPath(rt as never);
  assert.deepEqual(heard, [
    [
      'first-render-path',
      'WebGPU first render configuration',
      {
        clearColor: '#123456',
        targetSize: [640, 480],
        visibilityBuffer: true,
        visibilityReady: true,
        selectedPages: 2,
        drawnPages: 1,
      },
    ],
  ]);
  assert.equal(logged.mock.callCount(), 0);
});
