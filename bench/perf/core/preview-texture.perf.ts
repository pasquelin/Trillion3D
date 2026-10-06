// the geometry of a preview entry.
import { previewGeometry } from '../../../packages/sdk-core/src/texture/previewLevels.ts';
import { measure, stress, rapport } from '../../core/index.ts';
import type { MeasureCase } from '../../core/index.ts';
import { referenceExpectedGeometry } from '../../oracles/core/preview-texture.ts';

const DIMENSIONS: [number, number][] = [
  [0, 0],
  [1, 1],
  [64, 64],
  [65, 1],
  [1, 8192],
  [4096, 2048],
  [0xffffffff, 1],
  [3, 7],
];
const inputs: [number, number][] = [];
for (let i = 0; i < 4000; i++) inputs.push(DIMENSIONS[i % DIMENSIONS.length]);

/** The three numbers both sides publish: the oracle predates `sizes` and `blockBytes`. */
type GeometryNumbers = Pick<
  ReturnType<typeof previewGeometry>,
  'firstLevel' | 'levelCount' | 'pixelBytes'
>;

/** Each entry's three numbers, flat, in a buffer kept per list: the timed call allocates none. */
const geometries = (calculation: (width: number, height: number) => GeometryNumbers) => {
  const outputs = new Map<readonly unknown[], Float64Array>();
  return (list: readonly [number, number][]) => {
    let output = outputs.get(list);
    if (!output) outputs.set(list, (output = new Float64Array(list.length * 3)));
    for (let i = 0; i < list.length; i++) {
      const g = calculation(list[i][0], list[i][1]);
      [output[i * 3], output[i * 3 + 1], output[i * 3 + 2]] = [
        g.firstLevel,
        g.levelCount,
        g.pixelBytes,
      ];
    }
    return output;
  };
};

const cas: MeasureCase<[number, number][]>[] = [
  { name: '4 000 entries, eight boundary sizes', input: inputs, size: 4000 },
  { name: 'one 1×1 entry', input: [[1, 1]], size: 1 },
  { name: 'one max-side entry', input: [[0xffffffff, 0xffffffff]], size: 1 },
  { name: 'no entries', input: [], size: 0 },
];

const res = await measure({
  name: 'preview geometry',
  fichier: 'packages/sdk-core/src/texture/previewLevels.ts',
  cas,
  calculation: geometries(previewGeometry),
  expected: geometries(referenceExpectedGeometry),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'previewGeometry extremes',
  calculation: ([w, h]: [number, number]) => previewGeometry(w, h),
  extremes: [
    { name: 'zero', input: [0, 0] },
    { name: 'max 32-bit', input: [0xffffffff, 0xffffffff] },
    { name: 'asymmetric', input: [1, 1 << 16] },
  ],
});

rapport('preview-texture', [res], 'G11 yields the exact same input geometry');
