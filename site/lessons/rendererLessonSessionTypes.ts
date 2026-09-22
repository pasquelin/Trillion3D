import type { DiagnosticMode } from './engine-scene/diagnosticModes.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';

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
  diagnostic?: DiagnosticMode;
}

/** What mounts a lesson: its canvas, definition, first state, metrics sink and cancellation. */
export interface RendererLessonRuntimeOptions {
  canvas: HTMLCanvasElement;
  lesson: RendererLessonItem;
  state: Record<string, number>;
  report: (metrics: RendererMetrics) => void;
  signal?: AbortSignal;
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

export type Settle = (value?: unknown) => void;
