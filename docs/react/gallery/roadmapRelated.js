import { offlineExamples } from '../../js/gallery/offline/catalog.js';
const matches = [
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

export function relatedReadyLesson(entry) {
  const reference = offlineReference(entry);
  if (reference) return reference.lesson.id;
  const searchable = `${entry.id} ${entry.subject} ${entry.supplementaryTopic} ${entry.title.en}`;
  return matches.find(([pattern]) => pattern.test(searchable))?.[1];
}

export function offlineReference(entry) {
  const lesson = offlineExamples.find((candidate) => candidate.referenceIds.includes(entry.id));
  if (!lesson) return undefined;
  return { lesson, coverage: lesson.referenceCoverage[entry.id] };
}

export function galleryRoadmapEntry(entry) {
  const reference = offlineReference(entry);
  if (reference?.coverage !== 'full') return entry;
  return {
    ...entry,
    status: 'ready',
    readyLessonId: reference.lesson.id,
    renderer: true,
    preview: reference.lesson.preview,
  };
}
