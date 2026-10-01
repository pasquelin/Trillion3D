import type { ExplorerRuntimeSurface } from '../render/hostRuntime.ts';
import type { XrSession } from './platform.ts';
import { openXrDrawing } from './drawing.ts';

/** XR enters the ordinary host frame, so streaming, arrivals, metrics and memory budgets stay shared. */
export function explorerXrApi(inputs: ExplorerRuntimeSurface) {
  const { state, context, gpuDevice, webglSurface } = inputs;
  return {
    setXrActive(active: boolean) {
      state.xrActive = active;
      state.active.setXrActive?.(active);
    },
    async openXr(session: XrSession, render: () => void, transparent = false) {
      inputs.check();
      return openXrDrawing(session, {
        transparent,
        context,
        backend: state.active,
        device: gpuDevice,
        gl: webglSurface?.context,
        particleStep: inputs.particleStep,
        render(draw) {
          inputs.check();
          state.xrDraw = (backend) => {
            state.xrMetrics = draw(backend);
          };
          try {
            render();
          } finally {
            state.xrDraw = undefined;
            state.xrMetrics = undefined;
          }
        },
      });
    },
  };
}
