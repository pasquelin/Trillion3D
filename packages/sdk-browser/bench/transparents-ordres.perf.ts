// GEO-2: transparents in a few orders — blend passes and CPU fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import {
  benchSide,
  FACES,
  glisse,
  ITEMS,
  pose,
  regimes,
  type Frame,
} from './appui/scenesTransparents.ts';
import { appelsEncodes, tours } from './appui/toursTransparents.ts';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from './oracles/transparents-ordres.ts';

const scenes = FACES.map(([name, side]) => {
  const before = benchSide(side),
    after = benchSide(side);
  return { name, before, after, ...tours(before, after) };
});
type Scene = (typeof scenes)[number];

const casDe = (images: Frame[]) => [
  { name: `8 frames of ${ITEMS} items`, input: images, size: ITEMS * 8 },
];
const resultats = [];
for (const scene of scenes) {
  for (const [regime, images] of regimes) {
    resultats.push(
      await mesure({
        name: `orders and arguments — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendDraw.ts',
        cas: casDe(images),
        calcul: scene.tourApres,
        attendu: scene.tourAvant,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
    resultats.push(
      await mesure({
        name: `CPU fallback — ${scene.name}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendExpandCpu.ts',
        cas: casDe(images),
        calcul: scene.tourApresSeq,
        attendu: scene.tourAvantSeq,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
  }
}

function appelsDe(scene: Scene) {
  const image = glisse[0],
    etat = scene.before;
  pose(etat, image);
  classementReference(etat.scene, etat.order, image.eye);
  argumentsReference(etat.scene, etat.args);
  const before = encodeReference(etat.scene, etat.order, etat.args, etat.output);
  scene.tourApres([image]);
  return { name: scene.name, before: before.encoded, after: appelsEncodes() };
}

test('GEO-2: draw calls, single-sided and double-sided', () => {
  const comptes = scenes.map(appelsDe);
  assert.ok(comptes[0].after < comptes[0].before / 100, 'single-sided: a few orders');
  assert.equal(comptes[1].after, comptes[1].before, 'double-sided: no call removed');
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
