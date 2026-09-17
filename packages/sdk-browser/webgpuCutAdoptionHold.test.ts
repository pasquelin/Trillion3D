import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';
import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';

const uniforms = (): SelectionUniforms => ({
  planes: new Float32Array(24),
  view: new Float32Array(16),
  pixelScale: [1, 1],
  pixelError: 0,
  near: 0.1,
  cameraWorld: [0, 0, 0],
});

function banc(ids: number[]) {
  const packedPages: PageRec[] = ids.map(
    (_, i) =>
      ({
        url: `p${i}`,
        triangles: i + 1,
        transparent: i % 3 === 2,
        array: new Uint32Array(3),
        packedIndex: i,
      }) as unknown as PageRec,
  );
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = [];
  const residentOffsetWords = new Int32Array(packedPages.length).fill(0);
  const cut: GpuCut = {
    uniforms: uniforms(),
    result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  let peeked: GpuCut | null = cut;
  const drawnDelta = createCutDelta(packedPages, []);
  const counts = createCutCounts(packedPages, residentOffsetWords, drawnDelta);
  const adopter = createWebgpuCutAdopter({
    selection: () => ({ peek: () => peeked }) as unknown as GpuSelection,
    packedPages,
    desired,
    shown,
    drawn,
    uniforms: uniforms(),
    counts,
    delta: createCutDelta(packedPages, desired),
    drawnDelta,
    onCutDelta: () => {},
    onDrawnDelta: () => counts.apply(),
    onDrawnMirrored: () => {},
  });
  return {
    adopter,
    shown,
    drawn,
    residentOffsetWords,
    counts,
    packedPages,
    cut,
    montre: (next: GpuCut | null) => (peeked = next),
  };
}

test('un relevé déjà tenu ne refait pas la liste dessinable, et rend les mêmes comptes', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const { cutHeld: tenuPremier, listsRewritten: ecritPremier, ...premiers } = b.adopter.metrics;
  assert.equal(tenuPremier, false, 'le premier relevé n’est pas celui qu’on tenait');
  assert.equal(ecritPremier, true, 'et il a réécrit les listes');
  const listeShown = b.shown,
    listeDrawn = b.drawn;
  const contenu = [...b.shown];
  // Repérer une réécriture sans dépendre d'une horloge : un intrus que seule une réécriture efface.
  const intrus = { url: 'intrus' } as unknown as PageRec;
  b.shown.push(intrus);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.shown, listeShown, 'le tableau lui-même ne change pas');
  assert.equal(b.drawn, listeDrawn);
  assert.equal(b.shown.at(-1), intrus, 'la liste tenue n’est pas refaite');
  const { cutHeld: tenuSecond, listsRewritten: ecritSecond, ...seconds } = b.adopter.metrics;
  assert.deepEqual(seconds, premiers, 'les comptes sont ceux du même relevé');
  assert.equal(tenuSecond, true, 'le relevé tenu est annoncé tel quel');
  assert.equal(ecritSecond, false, 'et rien n’a été réécrit');
  b.shown.pop();

  // Les comptes suivent la résidence sans que la liste bouge : un trou apparaît, elle ne change pas.
  // Le journal des rangs nomme la page dont la ligne vient de partir ; ici le banc le fait pour lui.
  b.residentOffsetWords[1] = -1;
  b.counts.touch(1);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.adopter.metrics.uncoveredTriangles, 2, 'le trou est compté');
  assert.deepEqual(b.shown, contenu, 'la liste est restée celle du relevé');
});

test('un nouveau relevé refait la liste, et l’invalidation oublie celui qui était tenu', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const attendu = [...b.shown];
  const autre: GpuCut = {
    uniforms: b.cut.uniforms,
    result: { pageIds: [3, 1], drawablePageIds: [3, 1], frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  b.montre(autre);
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p3', 'p1'],
  );
  assert.deepEqual(b.drawn, b.shown);
  assert.equal(b.adopter.metrics.drawnTriangles, 4 + 2);

  // Après une coupe processeur, les tableaux ne viennent plus du relevé : il doit être oublié.
  b.montre(b.cut);
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(b.shown, attendu);
  // Oublier le relevé ne jette pas la différence : celui qui a écrit ces listes l'a publiée par
  // elle. Seule l'identité du relevé tombe, et la liste affichée est donc refaite en entier.
  b.adopter.forgetReadback();
  b.shown.length = 0;
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(b.shown, attendu, 'le relevé oublié est relu en entier');
});

test('un relevé NEUF qui republie les mêmes identifiants ne réécrit rien', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const contenu = [...b.shown];
  // C'est le cas d'une pose immobile : la carte rend un relevé par image, et ce relevé est le même.
  // Un objet différent portant la même suite d'identifiants ne change pas l'image d'un pixel.
  for (let image = 0; image < 3; image++) {
    b.montre({
      uniforms: b.cut.uniforms,
      result: {
        pageIds: [0, 1, 2, 3, 4],
        drawablePageIds: [0, 1, 2, 3, 4],
        frustumRejected: 0,
        lodLevel: 0,
      },
    } as GpuCut);
    assert.equal(b.adopter.adopt(), true, 'le relevé est bien adopté');
    assert.equal(
      b.adopter.metrics.listsRewritten,
      false,
      'un relevé identique ne réécrit aucune liste : le témoin d’image tenue doit survivre',
    );
    assert.equal(b.adopter.metrics.cutHeld, true);
    assert.deepEqual(b.shown, contenu, 'et la liste affichée est la même');
  }
});
