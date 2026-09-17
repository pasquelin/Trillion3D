import test from 'node:test';
import assert from 'node:assert/strict';
import { markDrawnDiverged, mirrorDrawnFromShown } from './webgpuPagesHelpers.ts';
import {
  fixturePages,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './webgpuCutAdopterFixture.ts';
import type { GpuCut } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';

// Sur le chemin de la carte graphique, `drawn` n'est que la recopie de `shown`. L'adoption la refait
// quand le relevé change ; l'image ne la refaisait pas moins, sans condition, juste après. Un
// drapeau dit désormais si elle est déjà en place, et ces tests l'épinglent des deux côtés : le
// helper qui décide, et l'adoption qui le lève exactement quand elle vient de recopier.

const page = (i: number) => ({ url: `p${i}`, triangles: i + 1 }) as unknown as PageRec;

test('la recopie n’a lieu que quand le drapeau est baissé, et le relève', () => {
  const run = { shown: [page(0), page(1)], drawn: [] as PageRec[], drawnMirrorsShown: false };
  assert.equal(mirrorDrawnFromShown(run), true, 'la première image recopie');
  assert.deepEqual(run.drawn, run.shown);
  assert.equal(run.drawnMirrorsShown, true);

  // Un intrus que seule une réécriture effacerait : le tour suivant ne doit pas y toucher.
  const intrus = page(99);
  run.drawn.push(intrus);
  assert.equal(mirrorDrawnFromShown(run), false, 'drapeau levé : rien n’est refait');
  assert.equal(run.drawn.at(-1), intrus);

  // La coupe processeur baisse le drapeau ; l'image suivante recopie le `shown` du moment.
  markDrawnDiverged(run);
  run.shown = [page(7)];
  assert.equal(mirrorDrawnFromShown(run), true);
  assert.deepEqual(
    run.drawn.map((rec) => rec.url),
    ['p7'],
  );
});

test('l’adoption annonce la recopie sur un relevé neuf, et jamais sur celui qu’elle tient déjà', () => {
  const ids = [0, 1, 2, 3];
  const packedPages = fixturePages(ids.length);
  let annonces = 0;
  const premier: GpuCut = {
    uniforms: fixtureUniforms(),
    result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  const second: GpuCut = {
    uniforms: fixtureUniforms(),
    result: { pageIds: [2, 0], drawablePageIds: [2, 0], frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  let peeked: GpuCut | null = premier;
  const { adopter, shown, drawn } = mountCutAdopter({
    packedPages,
    residentOffsetWords: new Int32Array(packedPages.length),
    uniforms: fixtureUniforms(),
    selection: () => peekOnly(() => peeked),
    onDrawnMirrored: () => annonces++,
  });

  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 1, 'le premier relevé fait la recopie et l’annonce');
  assert.deepEqual(drawn, shown);

  assert.equal(adopter.adopt(), true);
  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 1, 'un relevé déjà tenu ne recopie rien, donc n’annonce rien');

  peeked = second;
  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 2, 'un relevé neuf recopie et annonce à nouveau');
  assert.deepEqual(
    drawn.map((rec) => rec.url),
    ['p2', 'p0'],
  );
});
