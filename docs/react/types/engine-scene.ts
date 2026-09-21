import type { Locale } from './portal.ts';

export type DiagnosticMode =
  | 'beauty'
  | 'clusters'
  | 'pages'
  | 'wireframe'
  | 'lod'
  | 'screen-error'
  | 'materials'
  | 'visibility';

type SceneViewsCopy = Record<string, [string, string, string]>;

export interface EngineCopy {
  title: string;
  label: string;
  intro: string;
  try: string;
  start: string;
  loading: string;
  ready: string;
  unavailable: string;
  failed: string;
  retry: string;
  mode: string;
  beauty: string;
  clusters: string;
  pages: string;
  wireframe: string;
  lod: string;
  'screen-error': string;
  materials: string;
  visibility: string;
  views: SceneViewsCopy;
  guideWhat: string;
  guideTry: string;
  guideObserve: string;
  home: string;
  light: string;
  lightValue: string;
  shadows: string;
  quality: string;
  taa: string;
  previewAlt: string;
  preview: string;
  stats: string;
  selected: string;
  drawn: string;
  selectedDesc: string;
  drawnDesc: string;
  fps: string;
  fpsDesc: string;
  idle: string;
  cpu: string;
  cpuDesc: string;
  gpu: string;
  gpuDesc: string;
  geometryMemory: string;
  geometryMemoryDesc: string;
  textureMemory: string;
  textureMemoryDesc: string;
  unavailableMetric: string;
  scope: string;
  source: string;
  code: string;
  learn: string;
  steps: string[];
  controls: string;
  details: string;
  zoomIn: string;
  zoomOut: string;
  [key: string]: unknown;
}

export interface EnginePreviewProps {
  locale?: Locale;
  diagnostic?: DiagnosticMode;
}

export interface EngineGuideProps {
  copy: EngineCopy;
  locale: Locale;
  diagnostic: DiagnosticMode;
}

export interface SceneControlsProps {
  copy: EngineCopy;
  diagnostic?: DiagnosticMode;
}

export interface EngineStatsProps {
  copy: EngineCopy;
}

export interface EngineExampleProps {
  locale?: Locale;
  diagnostic?: DiagnosticMode;
  code?: string;
}

export interface EngineSceneProps {
  locale?: Locale;
}
