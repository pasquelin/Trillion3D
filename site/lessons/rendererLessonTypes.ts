import type { Localized } from '../content/locale.ts';

/** One legend swatch of a control that colours the image, e.g. the LOD diagnostic's levels. */
export interface RendererLessonLegendItem {
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
  legend?: RendererLessonLegendItem[];
}

/** A lesson's initial camera pose, applied on top of the explorer's own home pose. */
export interface RendererLessonPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** How a lesson positions its original scene against a third-party reference example. */
export interface RendererLessonReferenceReview {
  urls: string[];
  observed: string;
  originalGoal: string;
}

/**
 * A renderer lesson, as authored by one of the definition modules (lighting, camera, occlusion,
 * offline geometry) and, for interactive ones, completed by `rendererSceneFor` with the scene it
 * runs against. Fields below `changes` are producer-specific: an interactive light/camera/
 * occlusion lesson carries `kind`/`mode`/`runtime` and the scene assignment fields; an offline
 * geometry lesson instead carries `status`/`coverage`/`referenceIds`/`asset`/`code`.
 */
export interface RendererLessonItem {
  id: string;
  category: string;
  functions: string[];
  title: Localized;
  description: Localized;
  controls: RendererLessonControl[];
  try: Localized;
  changes: Localized;
  warning?: Localized;
  constructionCode?: string;
  /** The lesson shows the shadow page counters: pages redrawn since the last change, pages pending. */
  shadowStats?: boolean;
  /** The lesson's operation, e.g. `'point'`, `'shadow-switch'`, `'offline'`. */
  kind?: string;
  /** A camera lesson's operation, e.g. `'dolly'`, `'orbit'`. */
  mode?: string;
  /** The runtime that drives this lesson's updates, when it is not the default renderer one. */
  runtime?: string;
  renderer?: boolean;
  manifest?: string;
  preview?: string;
  importedLights?: boolean;
  sceneLight?: boolean;
  sceneFill?: boolean;
  initialPose?: RendererLessonPose;
  referenceCoverage?: Record<string, string>;
  referenceReview?: RendererLessonReferenceReview;
  /** An offline geometry lesson is published ready; the catalogue's union narrows on it. */
  status?: 'ready';
  coverage?: string;
  referenceIds?: string[];
  asset?: string;
  code?: string;
}
