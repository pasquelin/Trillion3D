// the geometry of a preview entry.
import { previewGeometry } from '../texturePreviewLevels.ts';
import { mesure, stress, rapport } from './socle.mjs';
import { referenceExpectedGeometry } from './oracles/preview-texture.mjs';

const DIMENSIONS = [
  [0, 0],
  [1, 1],
  [64, 64],
  [65, 1],
  [1, 8192],
  [4096, 2048],
  [0xffffffff, 1],
  [3, 7],
];
const inputs = [];
for (let i = 0; i < 4000; i++) inputs.push(DIMENSIONS[i % DIMENSIONS.length]);

const geometries = (calcul) => (liste) =>
  liste.map(([w, h]) => {
    const g = calcul(w, h);
    return [g.firstLevel, g.levelCount, g.pixelBytes];
  });

const cas = [
  { name: '4 000 entries, eight boundary sizes', input: inputs, size: 4000 },
  { name: 'one 1×1 entry', input: [[1, 1]], size: 1 },
  { name: 'one max-side entry', input: [[0xffffffff, 0xffffffff]], size: 1 },
  { name: 'no entries', input: [], size: 0 },
];

const res = await mesure({
  name: 'preview geometry',
  fichier: 'packages/sdk-core/texturePreviewLevels.ts',
  cas,
  calcul: geometries(previewGeometry),
  attendu: geometries(referenceExpectedGeometry),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'previewGeometry extremes',
  calcul: ([w, h]) => previewGeometry(w, h),
  extremes: [
    { name: 'zero', input: [0, 0] },
    { name: 'max 32-bit', input: [0xffffffff, 0xffffffff] },
    { name: 'asymmetric', input: [1, 1 << 16] },
  ],
});

rapport('preview-texture', [res], 'G11 yields the exact same input geometry');
