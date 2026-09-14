import * as THREE from 'three';
import type { AssetScope, DiagnosticMode, RuntimeEvent } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';

type Inputs = {
  measuring: boolean;
  diagnostic: DiagnosticMode;
  renderer?: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  baseline: RenderBackend;
  getActive: () => RenderBackend;
  setActive: (backend: RenderBackend) => void;
  setFallbackReason: (reason: string) => void;
  scope: AssetScope;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export function handleExplorerRenderError(error: unknown, inputs: Inputs) {
  const {
    measuring,
    diagnostic,
    renderer,
    camera,
    baseline,
    getActive,
    setActive,
    setFallbackReason,
    scope,
    emit,
    diagnose,
  } = inputs;
  if (measuring || diagnostic !== 'beauty') throw error;
  if (renderer?.getContext().isContextLost()) {
    const reason = 'Context lost: host must retain a stable preview and recreate the renderer';
    setFallbackReason(reason);
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
      backend: getActive().id,
      scope,
    });
    throw error;
  }
  const failedBackend = getActive();
  if (failedBackend === baseline) throw error;
  const reason = `Backend error: ${String(error)}`;
  setFallbackReason(reason);
  setActive(baseline);
  try {
    baseline.render(camera);
    renderer!.render(baseline.scene, camera);
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
