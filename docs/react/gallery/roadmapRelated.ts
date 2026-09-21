import { rendererLessons } from '../../js/gallery/rendererLessons.js';
import type { GalleryExample, RoadmapExample } from '../types/gallery.ts';

type RoadmapReference = Pick<GalleryExample, 'id' | 'subject' | 'supplementaryTopic' | 'title'>;

const matches: [RegExp, string][] = [
  [/quaternion/, 'quaternion-turn'],
  [/normal/, 'normal-transform'],
  [/(inverse|invert)/, 'matrix-inverse'],
  [/(determinant|orientation)/, 'reflection-orientation'],
  [/(frustum|cull)/, 'frustum'],
  [/(perspective|camera|orthographic)/, 'perspective'],
  [/(bounding.?box|boxselection)/, 'box-grow'],
  [/(bounding.?sphere)/, 'sphere-from-box'],
  [/(hierarchy|parent|child)/, 'hierarchy'],
  [/(cross.?product)/, 'cross-product'],
  [/(dot.?product)/, 'dot-product'],
  [/(normalize|unit.?vector)/, 'normalize'],
  [/(matrix|transform)/, 'compose-transform'],
  [/(colour|color|material|texture)/, 'color-space'],
  [/(lod|level.?of.?detail|performance)/, 'lod-budget'],
];

export function relatedReadyLesson(entry: RoadmapReference): string | undefined {
  const reference = lessonReference(entry);
  if (reference) return reference.lesson.id;
  const searchable = `${entry.id} ${entry.subject} ${entry.supplementaryTopic} ${entry.title.en}`;
  return matches.find(([pattern]) => pattern.test(searchable))?.[1];
}

function lessonReference(entry: RoadmapReference) {
  const lesson = rendererLessons.find((candidate) => candidate.referenceCoverage?.[entry.id]);
  if (!lesson) return undefined;
  return { lesson, coverage: lesson.referenceCoverage[entry.id] };
}

export function galleryRoadmapEntry(entry: RoadmapExample): GalleryExample {
  const reference = lessonReference(entry);
  if (reference?.coverage !== 'full') return entry;
  return {
    ...entry,
    status: 'ready',
    readyLessonId: reference.lesson.id,
    renderer: true,
    preview: reference.lesson.preview,
  };
}
