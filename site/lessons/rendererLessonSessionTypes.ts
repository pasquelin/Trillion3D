import type { Explorer } from '../../packages/sdk-browser/index.ts';
import type { DiagnosticMode } from './engine-scene/diagnosticModes.ts';
import type { DiagnosticMode as EngineDiagnosticMode } from '../../packages/sdk/index.ts';

/** What the lesson runtime reports each frame; `null` is a count the device did not give. */
export interface RendererMetrics {
  idle?: boolean;
  fps?: number | null;
  cpu?: number;
  memory?: number | null;
  triangles?: number | null;
  shadowPages?: number;
  shadowPending?: number | null;
  occluded?: number | null;
  tested?: number | null;
  diagnostic?: EngineDiagnosticMode;
}

export interface RendererLessonSession {
  update: (next: Record<string, number>) => Promise<void>;
  dispose: () => void;
  setDiagnostic: (mode: DiagnosticMode) => void;
  camera: {
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
  };
}

export type Controls = ReturnType<Explorer['controls']>;
export type Settle = (value?: unknown) => void;
