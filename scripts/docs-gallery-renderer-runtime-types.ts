// Shared browser-side types for the renderer lesson runtime and lesson table: both are ES
// modules loaded by URL inside `page.evaluate`, so TypeScript cannot resolve their shape from
// the specifier alone. These mirror the real exported signatures for the boundary cast that
// stands in for that resolution, used by every gallery browser proof that drives the runtime
// directly rather than through the mounted page.
import type { createRendererLessonRuntime as createRendererLessonRuntimeSignature } from '../site/lessons/rendererLessonRuntime.ts';
import type {
  rendererInitialState as rendererInitialStateSignature,
  rendererLessonById as rendererLessonByIdSignature,
} from '../site/lessons/rendererLessons.ts';

export interface RendererRuntimeModule {
  createRendererLessonRuntime: typeof createRendererLessonRuntimeSignature;
}

export interface RendererLessonsModule {
  rendererInitialState: typeof rendererInitialStateSignature;
  rendererLessonById: typeof rendererLessonByIdSignature;
}
