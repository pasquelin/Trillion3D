import type { AssetScope, DiagnosticMode } from '../sdk-core/src/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerEmitters } from './explorerSession.ts';
import type { createFrameComposer } from './explorerCompose.ts';
import type { WebglSurface } from './webglSurface.ts';

type Inputs = ExplorerEmitters & {
  measuring: boolean;
  diagnostic: DiagnosticMode;
  /** The engine's surface, absent on the direct WebGPU path: a lost one is a fatal, not a fallback. */
  webglSurface?: Pick<WebglSurface, 'lost'>;
  camera: HostCamera;
  baseline: RenderBackend;
  state: Pick<ExplorerHostState, 'active' | 'fallbackReason'>;
  scope: AssetScope;
  compose: ReturnType<typeof createFrameComposer>;
};

export function handleExplorerRenderError(error: unknown, inputs: Inputs) {
  const {
    measuring,
    diagnostic,
    webglSurface,
    camera,
    baseline,
    state,
    scope,
    emit,
    diagnose,
    compose,
  } = inputs;
  if (measuring || diagnostic !== 'beauty') throw error;
  if (webglSurface?.lost) {
    const reason = 'Context lost: host must retain a stable preview and recreate the renderer';
    state.fallbackReason = reason;
    emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'CONTEXT_LOST',
      detail: reason,
    });
    diagnose('error', 'WebGL context lost', {
      kind: 'error',
      error: String(error),
      code: 'CONTEXT_LOST',
      backend: state.active.id,
      scope,
    });
    throw error;
  }
  const failedBackend = state.active;
  if (failedBackend === baseline) throw error;
  const reason = `Backend error: ${String(error)}`;
  state.fallbackReason = reason;
  state.active = baseline;
  try {
    baseline.render(camera);
    compose(baseline, null, false);
  } catch (fatal) {
    emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'BASELINE_FAILED',
      detail: String(fatal),
    });
    diagnose('error', 'Baseline backend failed after fallback', {
      kind: 'error',
      error: String(fatal),
      code: 'BASELINE_FAILED',
      scope,
    });
    throw fatal;
  }
  emit({
    eventVersion: 1,
    type: 'fallback',
    audience: 'diagnostic',
    recovered: true,
    code: 'BACKEND_ERROR',
    detail: reason,
  });
  diagnose('fallback', 'Active backend failed; baseline rendered', {
    kind: 'fallback',
    error: String(error),
    from: failedBackend.id,
    to: baseline.id,
    scope,
  });
}
