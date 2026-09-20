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
  const offline = offlineExamples.find((lesson) => lesson.referenceIds.includes(entry.id));
  if (offline) return offline.id;
  const searchable = `${entry.id} ${entry.subject} ${entry.supplementaryTopic} ${entry.title.en}`;
  return matches.find(([pattern]) => pattern.test(searchable))?.[1];
}
