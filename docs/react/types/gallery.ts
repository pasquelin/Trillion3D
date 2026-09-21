import type { Locale } from './portal.ts';
import type { DiagnosticMode } from './engine-scene.ts';
import type { ProgressiveListState } from './components.ts';
import type { Localized } from '../gallery/localized.ts';
import type { SCENARIOS } from '../../js/gallery/scenarios.js';

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

export interface ExampleCardProps {
  example: GalleryExample;
  locale?: Locale;
  expanded?: boolean;
  onOpen?: (id: string) => void;
}

export interface CardSummaryProps {
  example: GalleryExample;
  locale: Locale;
  title: string;
  description: string;
  arrow?: boolean;
}

export interface PreviewProps {
  example: GalleryExample;
  locale: Locale;
  title: string;
}

export interface PlannedDetailsProps {
  example: RoadmapExample;
  locale: Locale;
}

export interface ThemeTabsProps {
  active: string;
  available: string[];
  locale: Locale;
  onSelect: (item: string) => void;
}

export interface GalleryShowcaseProps {
  locale: Locale;
}

export interface ShowcaseScene {
  id: string;
  preview: string;
  title: Localized;
  description: Localized;
  action: Localized;
  alt: Localized;
}

export type Scenario = (typeof SCENARIOS)[string];

export interface PlaygroundProps {
  id: string;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

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

export type DiagramProps = Pick<WebGPUCanvasProps, 'id' | 'state' | 'locale' | 'label'>;

export type GeometryPreviewProps = Pick<
  WebGPUCanvasProps,
  'id' | 'locale' | 'interactive' | 'label' | 'related'
>;

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

export interface RendererLessonProps {
  lesson: RendererLessonItem;
  locale?: Locale;
  onSelect?: (id: string) => void;
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

export interface RendererViewportProps {
  lesson: RendererLessonItem;
  state: Record<string, number>;
  locale: Locale;
  label: string;
}

export interface GalleryViewState {
  query: string;
  category: string;
  progressive?: ProgressiveListState;
  scrollY: number;
}
