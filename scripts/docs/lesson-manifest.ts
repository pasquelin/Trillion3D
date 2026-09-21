import { rendererLessons } from '../../site/lessons/rendererLessons.ts';
import type { RendererLessonItem } from '../../site/lessons/rendererLessonTypes.ts';

/** Finds a renderer lesson by predicate, asserting it exists: every caller here only runs on
 * ids known to be present in the catalogue, so a miss is a test bug, not a case to report. */
export function requiredLesson(
  predicate: (lesson: RendererLessonItem) => boolean,
): RendererLessonItem {
  const lesson = rendererLessons.find(predicate);
  if (!lesson) throw new Error('expected renderer lesson not found');
  return lesson;
}
