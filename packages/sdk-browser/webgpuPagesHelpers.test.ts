// `shownFromGpu` (lot triangles synchrones) : trois totaux d'une même passe — `selectedTriangles`
// la coupe entière, `uncoveredTriangles` le trou (grappe sans page résidente), `drawnTriangles` ce
// qui reste et part au dessin. La relation de couverture `selected − drawn − uncovered = 0` doit
// tenir même quand certaines grappes de la coupe n'ont pas de ligne de résidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shownFromGpu } from './webgpuPagesHelpers.ts';
import type { PageRec } from './pageSelection.ts';

function page(id: number, triangles: number, resident: boolean): PageRec {
  return {
    id,
    triangles,
    array: resident ? new Uint32Array(3) : undefined,
  } as unknown as PageRec;
}

test('shownFromGpu : drawn = selected − uncovered quand des grappes de la coupe n’ont pas de page résidente', () => {
  // Quatre grappes sélectionnées : deux résidentes (10, 30 triangles), deux non résidentes faute de
  // ligne dans `residentOffsetWords` (5) ou de tampon (7).
  const pages: PageRec[] = [page(0, 10, true), page(1, 5, true), page(2, 30, true), page(3, 7, false)];
  const residentOffsetWords = new Int32Array([0, -1, 4, 8]); // id 1 : pas de ligne de résidence.
  const ids = [0, 1, 2, 3];

  const counts = shownFromGpu(pages, ids, undefined, residentOffsetWords);

  assert.equal(counts.selectedTriangles, 10 + 5 + 30 + 7);
  assert.equal(counts.uncoveredTriangles, 5 + 7);
  assert.equal(counts.drawnTriangles, counts.selectedTriangles - counts.uncoveredTriangles);
  assert.equal(
    counts.selectedTriangles - counts.drawnTriangles - counts.uncoveredTriangles,
    0,
    'relation de couverture',
  );
});

test('shownFromGpu : toutes les grappes résidentes, aucun trou, drawn = selected', () => {
  const pages: PageRec[] = [page(0, 12, true), page(1, 8, true)];
  const residentOffsetWords = new Int32Array([0, 4]);
  const counts = shownFromGpu(pages, [0, 1], undefined, residentOffsetWords);
  assert.equal(counts.selectedTriangles, 20);
  assert.equal(counts.uncoveredTriangles, 0);
  assert.equal(counts.drawnTriangles, 20);
});
