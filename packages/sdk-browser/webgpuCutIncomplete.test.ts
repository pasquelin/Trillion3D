import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';
import { ESCALATION_SLACK } from './pageSelectionTypes.ts';
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

/** Un adopteur et sa coupe, dont la complétude se règle relevé par relevé. */
function banc(ids: number[]) {
  const packedPages: PageRec[] = ids.map(
    (_, i) =>
      ({
        url: `p${i}`,
        triangles: i + 1,
        transparent: false,
        array: new Uint32Array(3),
        packedIndex: i,
      }) as unknown as PageRec,
  );
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = [];
  const shared = uniforms();
  const releve = (complete: boolean): GpuCut =>
    ({
      uniforms: shared,
      result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0, complete },
    }) as GpuCut;
  let peeked: GpuCut | null = releve(false);
  const counts = createCutCounts(packedPages, new Int32Array(packedPages.length).fill(0));
  const adopter = createWebgpuCutAdopter({
    selection: () => ({ peek: () => peeked }) as unknown as GpuSelection,
    packedPages,
    desired,
    shown,
    drawn,
    uniforms: shared,
    counts,
    delta: createCutDelta(packedPages, desired),
    drawnDelta: createCutDelta(packedPages, []),
    onCutDelta: () => {},
    onDrawnDelta: (delta) => counts.apply(delta),
    onDrawnMirrored: () => {},
  });
  return { adopter, desired, shown, montre: (complete: boolean) => (peeked = releve(complete)) };
}

test('une page voulue pas encore arrivée met l’image en attente, sans jeter la sélection GPU', () => {
  const b = banc([0, 1, 2, 3]);
  // Le relevé annonce un trou : une page que le noyau veut dessiner n'est pas résidente.
  assert.doesNotThrow(() => b.adopter.adopt(), 'une couverture incomplète n’est pas une erreur');
  assert.equal(b.adopter.adopt(), false, 'l’image n’adopte pas un relevé incomplet');
  assert.equal(b.adopter.metrics.incomplete, true, 'et elle le dit');
  assert.equal(b.adopter.metrics.ready, false, 'aucun compte du relevé n’est publié');
  assert.deepEqual(b.shown, [], 'rien n’est dessiné depuis un relevé incomplet');
  // La liste voulue est tout de même publiée : c'est elle qui fait venir la page manquante.
  assert.deepEqual(
    b.desired.map((page) => page.url),
    ['p0', 'p1', 'p2', 'p3'],
  );

  // La page arrive : le relevé suivant est complet et la sélection GPU dessine de nouveau.
  b.montre(true);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.adopter.metrics.incomplete, false);
  assert.equal(b.adopter.metrics.ready, true);
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p0', 'p1', 'p2', 'p3'],
  );
});

test('le seuil d’escalade est posé strictement au-dessus de l’erreur du parent, en f32', () => {
  // L'escalade posait le seuil À l'erreur du parent : les deux bascules du choix tenaient sur une
  // égalité exacte entre une valeur écrite par une passe et la même recalculée par une autre. Sur
  // l'appareil, le pilote ne rend pas le même f32 d'un point d'entrée à l'autre — dérive mesurée
  // sur `dagMask` : 1 à 13 unités du dernier bit. La marge doit couvrir cette dérive largement.
  const ulps = (valeur: number) => {
    const bits = new Uint32Array(1),
      flottant = new Float32Array(bits.buffer);
    flottant[0] = valeur;
    const bas = bits[0]!;
    flottant[0] = Math.fround(valeur * ESCALATION_SLACK);
    return bits[0]! - bas;
  };
  for (const erreur of [1e-4, 0.017, 0.25, 1, 3.7, 64, 4096, 1e6]) {
    assert.ok(
      Math.fround(erreur * ESCALATION_SLACK) > erreur,
      `le seuil escaladé doit dépasser ${erreur}`,
    );
    assert.ok(ulps(erreur) >= 256, `marge de ${ulps(erreur)} unités du dernier bit sur ${erreur}`);
  }
  // Et elle reste quatre ordres de grandeur sous le pixel : la coupe ne s'en trouve pas changée.
  assert.ok(ESCALATION_SLACK - 1 < 1e-4);
});
