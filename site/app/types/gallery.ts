import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode } from './engine-scene.ts';
import type { ProgressiveListState } from './components.ts';
import type { Localized } from '../../content/locale.ts';
import type { SCENARIOS } from '../../lessons/scenarios.ts';

interface ExampleBase {
  id: string;
  title: Localized;
  category: string;
  functions?: string[];
  engine?: boolean;
  renderer?: boolean;
  preview?: string;
  readyLessonId?: string;
}

/** A catalog lesson describes itself and is ready. */
export interface CatalogExample extends ExampleBase {
  status?: 'ready';
  description: Localized;
  concept?: undefined;
  reason?: undefined;
  subject?: undefined;
  supplementaryTopic?: undefined;
}

/** A roadmap entry states the concept it will show and why it still waits. */
export interface RoadmapExample extends ExampleBase {
  status: string;
  description?: undefined;
  concept: Localized;
  reason: Localized;
  subject: string;
  supplementaryTopic: string;
}

export type GalleryExample = CatalogExample | RoadmapExample;

export type Scenario = (typeof SCENARIOS)[string];

export interface WebGPUCanvasProps {
  id: string;
  state: Record<string, number>;
  locale: Locale;
  preview?: boolean;
  interactive?: boolean;
  animating?: boolean;
  label?: string;
  related?: boolean;
}

export interface IllustrationSession {
  update: (nextState: Record<string, unknown>) => void;
  setAnimating?: (next: boolean) => void;
  dispose: () => void;
}

interface RendererLessonLegend {
  color: string;
  label: Localized;
}

export interface RendererLessonControl {
  id: string;
  label: Localized;
  type?: 'range' | 'boolean';
  value: number;
  min: number;
  max: number;
  step: number;
  legend?: RendererLessonLegend[];
}

export interface RendererLessonItem {
  id: string;
  title: Localized;
  description: Localized;
  try: Localized;
  changes: Localized;
  warning?: Localized;
  constructionCode?: string;
  functions: string[];
  controls: RendererLessonControl[];
}

/** What the lesson runtime reports each frame; `null` is a count the device did not give. */
export interface RendererMetrics {
  idle?: boolean;
  fps?: number | null;
  cpu?: number;
  memory?: number;
  triangles?: number;
  occluded?: number | null;
  tested?: number | null;
  diagnostic?: DiagnosticMode;
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

export interface GalleryViewState {
  query: string;
  category: string;
  progressive?: ProgressiveListState;
  scrollY: number;
}
