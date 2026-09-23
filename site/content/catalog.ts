import { rendererLessons } from '../lessons/rendererLessons.ts';
import { localized } from './i18n/dictionary.ts';
import type { Dictionary } from './i18n/languages.inline.ts';
import type { Localized } from './locale.ts';

interface ExampleBase {
  id: string;
  title: Localized;
  category: string;
  functions?: string[];
  engine?: boolean;
  renderer?: boolean;
  preview?: string;
}

/** A catalog lesson describes itself and is ready. */
export interface CatalogExample extends ExampleBase {
  status?: 'ready';
  description: Localized;
}

type WrittenLesson = Omit<CatalogExample, 'title' | 'description'> & {
  id: keyof Dictionary['catalog'];
};

/** A lesson of this file, its title and description each language's `catalog.<id>`. */
const described = (lesson: WrittenLesson): CatalogExample => ({
  ...lesson,
  title: localized(({ catalog }) => catalog[lesson.id].title),
  description: localized(({ catalog }) => catalog[lesson.id].description),
});

const WRITTEN_LESSONS: WrittenLesson[] = [
  {
    id: 'compose-transform',
    category: 'transforms',
    functions: ['composeMatrix4', 'transformAffinePoint'],
  },
  {
    id: 'matrix-chain',
    category: 'transforms',
    functions: ['multiplyMatrix4', 'transformAffinePoint'],
  },
  {
    id: 'matrix-inverse',
    category: 'transforms',
    functions: ['composeMatrix4', 'invertMatrix4', 'multiplyMatrix4', 'transformAffinePoint'],
  },
  {
    id: 'reflection-orientation',
    category: 'transforms',
    functions: ['composeMatrix4', 'determinantMatrix4', 'linearPartDeterminant'],
  },
  {
    id: 'quaternion-turn',
    category: 'transforms',
    functions: ['composeMatrix4', 'transformDirectionVector3'],
  },
  {
    id: 'normal-transform',
    category: 'vectors',
    functions: ['composeMatrix4', 'normalMatrix3', 'applyMatrix3Vector3', 'normalizeVector3'],
  },
  {
    id: 'perspective',
    category: 'camera',
    functions: ['perspectiveProjection', 'transformHomogeneousPoint'],
  },
  {
    id: 'frustum',
    category: 'camera',
    functions: ['perspectiveProjection', 'frustumPlanesFromMatrix', 'frustumClipBox'],
  },
  {
    id: 'dot-product',
    category: 'vectors',
    functions: ['dotVector3'],
  },
  {
    id: 'cross-product',
    category: 'vectors',
    functions: ['crossVector3'],
  },
  {
    id: 'normalize',
    category: 'vectors',
    functions: ['normalizeVector3', 'lengthSqVector3'],
  },
  {
    id: 'box-grow',
    category: 'bounds',
    functions: ['boxEmpty', 'boxExpandByPoint'],
  },
  {
    id: 'sphere-from-box',
    category: 'bounds',
    functions: ['sphereFromBounds'],
  },
  {
    id: 'hierarchy',
    category: 'scene',
    functions: [
      'createTransformTree',
      'addTransformNode',
      'setNodePosition',
      'updateNodeWorldMatrix',
      'nodeWorldPosition',
    ],
  },
  {
    id: 'color-space',
    category: 'color',
    functions: ['srgbToLinear', 'linearToSrgb'],
  },
  {
    id: 'lod-budget',
    category: 'streaming',
    functions: ['lodQuality', 'adaptivePixelError', 'createPathGovernor'],
  },
];

export const examples: CatalogExample[] = [...WRITTEN_LESSONS.map(described), ...rendererLessons];

export const byId = (id: string) => examples.find((example) => example.id === id) ?? examples[0];
