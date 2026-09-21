import type { RendererLessonSession } from './rendererLessonSessionTypes.ts';

export const syncRendererState = (
  runtime: RendererLessonSession,
  initial: Record<string, number>,
  latest: Record<string, number>,
) => (initial === latest ? Promise.resolve() : runtime.update(latest));
