import { readFile } from 'node:fs/promises';
import { rendererLessons } from '../../site/lessons/rendererLessons.ts';
import type { RendererLessonItem } from '../../site/lessons/rendererLessonTypes.ts';
import type { RendererLessonSession } from '../../site/lessons/rendererLessonSessionTypes.ts';

/** Finds a renderer lesson by predicate, asserting it exists: every caller here only runs on
 * ids known to be present in the catalogue, so a miss is a test bug, not a case to report. */
export function requiredLesson(
  predicate: (lesson: RendererLessonItem) => boolean,
): RendererLessonItem {
  const lesson = rendererLessons.find(predicate);
  if (!lesson) throw new Error('expected renderer lesson not found');
  return lesson;
}

/** A `RendererLessonSession` mock whose only live member is `update`; the other members are
 * unused by `syncRendererState`, which only calls `update`. */
export function noopSession(update: RendererLessonSession['update']): RendererLessonSession {
  return {
    update,
    dispose: () => {},
    setDiagnostic: () => {},
    camera: { zoomIn: () => {}, zoomOut: () => {}, reset: () => {} },
  };
}

/** Reads a renderer lesson's resolved cache manifest, following its LOD pointer file, resolved
 * against `base` (the caller's `import.meta.url`) exactly as the two callers used to inline it. */
export async function readPointedManifest(manifestPath: string, base: string | URL) {
  const pointer = JSON.parse(
    await readFile(new URL(`../site/${manifestPath.slice(2)}`, base), 'utf8'),
  );
  return JSON.parse(
    await readFile(
      new URL(`../site/${manifestPath.slice(2).replace('manifest.json', pointer.url)}`, base),
      'utf8',
    ),
  );
}
