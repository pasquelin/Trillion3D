import type { Locale } from './portal.ts';
import type { DiagnosticMode } from './engine-scene.ts';
import type { ProgressiveListState } from './components.ts';

export type LocalizedString = { en: string; fr: string } | { en: string; fr?: string };

export interface GalleryExample {
  id: string;
  title: LocalizedString;
  description?: LocalizedString;
  concept?: LocalizedString;
  reason?: LocalizedString;
  category?: string;
  subject?: string;
  supplementaryTopic?: string;
  functions?: string[];
  engine?: boolean;
  renderer?: boolean;
  preview?: string;
  status?: 'ready' | 'planned' | string;
  readyLessonId?: string;
  [key: string]: unknown;
}

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
  example: GalleryExample;
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
  title: { en: string; fr: string };
  description: { en: string; fr: string };
  action: { en: string; fr: string };
  alt: { en: string; fr: string };
}

export interface PlaygroundProps {
  id: string;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

export interface DiagramProps {
  id: string;
  state: Record<string, number>;
  locale: Locale;
  label?: string;
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

export interface GeometryPreviewProps {
  id: string;
  locale?: Locale;
  interactive?: boolean;
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
  label: { en: string; fr: string };
}

export interface RendererLessonControl {
  id: string;
  label: { en: string; fr: string };
  type: 'range' | 'boolean' | string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  legend?: RendererLessonLegend[];
}

interface RendererLessonItem {
  id: string;
  title: { en: string; fr: string };
  description: { en: string; fr: string };
  try: { en: string; fr: string };
  changes: { en: string; fr: string };
  warning?: { en: string; fr: string };
  constructionCode?: string;
  functions: string[];
  controls: RendererLessonControl[];
  [key: string]: unknown;
}

export interface RendererLessonProps {
  lesson: RendererLessonItem;
  locale?: Locale;
  onSelect?: (id: string) => void;
}

export interface RendererMetrics {
  idle?: boolean;
  fps?: number;
  cpu?: number;
  memory?: number;
  triangles?: number;
  occluded?: number;
  tested?: number;
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
