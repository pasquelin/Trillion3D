// GEO-2: transparents in a few orders — blend passes and CPU fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, stress, rapport } from '../../core/index.ts';
import { FACES, glisse, ITEMS, regimes, type Frame } from './support/scenesTransparent.ts';
import { callsOf, sceneDe } from './support/transparentRounds.ts';

const scenes = FACES.map(([name, side]) => sceneDe(name, side));

const casDe = (images: Frame[]) => [
  { name: `8 frames of ${ITEMS} items`, input: images, size: ITEMS * 8 },
];
const results = [];
for (const scene of scenes) {
  for (const [regime, images] of regimes) {
    results.push(
      await measure({
        name: `orders and arguments — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/src/webgpu/blend/draw.ts',
        cas: casDe(images),
        calculation: scene.passAfter,
        expected: scene.passBefore,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
    results.push(
      await measure({
        name: `CPU fallback — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/src/webgpu/blend/expandCpu.ts',
        cas: casDe(images),
        calculation: scene.passAfterSeq,
        expected: scene.passBeforeSeq,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
  }
}

test('GEO-2: draw calls, single-sided and double-sided', () => {
  const counts = scenes.map(callsOf);
  console.table(counts);
  for (const { name, before, after } of counts)
    assert.ok(after < before / 100, `${name}: a few orders`);
});

await stress({
  name: 'blend draw extremes',
  calculation: (imgs) => scenes[0].passAfter(imgs),
  extremes: [{ name: 'standard slide', input: glisse.slice(0, 1) }],
});

rapport(
  'transparents-ordres',
  results,
  'GEO-2: both paths paint the same ranges, in the same order',
);
