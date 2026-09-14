import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { ComparisonLayout } from './comparison.ts';

type Inputs = {
  check: () => void;
  backends: RenderBackend[];
  diagnostic: () => DiagnosticMode;
  selectBackend: (backend: RenderBackend) => void;
  setComparison: (
    layout: ComparisonLayout,
    pair?: [string, string],
    wipe?: number,
    toggle?: 0 | 1,
  ) => void;
  directGpu: boolean;
  context: BackendContext;
};

export function createExplorerSelectionApi(inputs: Inputs) {
  const { check, backends, diagnostic, selectBackend, setComparison, directGpu, context } = inputs;
  return {
    select(id: string) {
      check();
      if (
        (diagnostic() === 'clusters' ||
          diagnostic() === 'pages' ||
          diagnostic() === 'lod' ||
          diagnostic() === 'visibility' ||
          diagnostic() === 'screen-error') &&
        id !== 'exact-cluster-pages' &&
        id !== 'three-lod' &&
        id !== 'webgpu-page-raster'
      )
        throw new Error('Reference has no clusters; switch to beauty first');
      const selected = backends.find((backend) => backend.id === id);
      if (!selected) throw new Error(`Unknown backend: ${id}`);
      selectBackend(selected);
    },
    setComparison(
      layout: ComparisonLayout,
      pair?: [string, string],
      nextWipe?: number,
      nextToggle?: 0 | 1,
    ) {
      check();
      if (directGpu && layout !== 'single') throw new Error('SINGLE_BACKEND_COMPARISON');
      setComparison(layout, pair, nextWipe, nextToggle);
    },
    setPixelError(value: number) {
      check();
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid pixelError');
      context.pixelError = value;
    },
  };
}
