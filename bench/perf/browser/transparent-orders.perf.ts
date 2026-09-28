// GEO-2: transparents in a few orders — blend passes and CPU fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure, stress, rapport } from '../../core/index.ts';
import { FACES, glisse, ITEMS, regimes, type Frame } from './support/scenesTransparent.ts';
import { appelsDe, sceneDe } from './support/transparentRounds.ts';

const scenes = FACES.map(([name, side]) => sceneDe(name, side));

const casDe = (images: Frame[]) => [
  { name: `8 frames of ${ITEMS} items`, input: images, size: ITEMS * 8 },
];
const resultats = [];
for (const scene of scenes) {
  for (const [regime, images] of regimes) {
    resultats.push(
      await mesure({
        name: `orders and arguments — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/src/webgpu/blend/draw.ts',
        cas: casDe(images),
        calcul: scene.tourApres,
        attendu: scene.tourAvant,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
    resultats.push(
      await mesure({
        name: `CPU fallback — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/src/webgpu/blend/expandCpu.ts',
        cas: casDe(images),
        calcul: scene.tourApresSeq,
        attendu: scene.tourAvantSeq,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
  }
}

test('GEO-2: draw calls, single-sided and double-sided', () => {
  const comptes = scenes.map(appelsDe);
  console.table(comptes);
  for (const { name, before, after } of comptes)
    assert.ok(after < before / 100, `${name}: a few orders`);
});

await stress({
  name: 'blend draw extremes',
  calcul: (imgs) => scenes[0].tourApres(imgs),
  extremes: [{ name: 'standard slide', input: glisse.slice(0, 1) }],
});

rapport(
  'transparents-ordres',
  resultats,
  'GEO-2: both paths paint the same ranges, in the same order',
);
