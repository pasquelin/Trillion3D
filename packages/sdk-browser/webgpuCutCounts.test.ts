// Les totaux du relevé de coupe, tenus par la différence au lieu d'être resommés : `selected` la
// coupe dessinable entière, `uncovered` le trou (grappe sans ligne de résidence ni octets), `drawn`
// ce qui reste, `transparent` la part en mélange. Oracle : la passe complète d'avant, qui resommait
// la coupe à chaque adoption.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';

function page(triangles: number, transparent: boolean, resident: boolean): PageRec {
  return { triangles, transparent, array: resident ? new Uint32Array(3) : undefined } as PageRec;
}

/** La passe complète : trois totaux d'une seule boucle sur la suite publiée. */
function reference(pages: readonly PageRec[], ids: readonly number[], offsets: Int32Array) {
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  for (let i = 0; i < ids.length; i++) {
    const rec = pages[ids[i]];
    if (!rec) continue;
    selected += rec.triangles;
    if (rec.transparent) transparent += rec.triangles;
    if (offsets[ids[i]] < 0 || !rec.array) uncovered += rec.triangles;
  }
  return {
    selectedTriangles: selected,
    drawnTriangles: selected - uncovered,
    uncoveredTriangles: uncovered,
    transparentTriangles: transparent,
  };
}

/** Un flux pseudo-aléatoire reproductible : le balayage doit être le même à chaque exécution. */
function stream(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

test('la relation de couverture tient, trou compris, sur une coupe posée une fois', () => {
  const pages = [
    page(10, false, true),
    page(5, false, true),
    page(30, true, true),
    page(7, false, false),
  ];
  const offsets = Int32Array.from([0, -1, 4, 8]);
  const counts = createCutCounts(pages, offsets),
    delta = createCutDelta(pages);
  delta.apply([0, 1, 2, 3]);
  const totals = counts.apply(delta);
  assert.deepEqual({ ...totals }, reference(pages, [0, 1, 2, 3], offsets));
  assert.equal(totals.uncoveredTriangles, 5 + 7, 'sans ligne de résidence (1), sans octets (3)');
  assert.equal(
    totals.selectedTriangles - totals.drawnTriangles - totals.uncoveredTriangles,
    0,
    'relation de couverture',
  );
});

test('une coupe relue à l’identique ne touche pas un compteur', () => {
  const pages = [page(10, false, true), page(4, true, true)];
  const offsets = Int32Array.from([0, 4]);
  const counts = createCutCounts(pages, offsets),
    delta = createCutDelta(pages);
  delta.apply([0, 1]);
  counts.apply(delta);
  const avant = { ...counts.totals };
  delta.apply([0, 1]);
  assert.equal(delta.enteredCount + delta.exitedCount, 0, 'aucune page entrée ni sortie');
  assert.deepEqual({ ...counts.apply(delta) }, avant);
});

test('une couverture qui bascule sous la coupe est reprise par la seule page nommée', () => {
  const pages = [page(10, false, true), page(6, false, true)];
  const offsets = Int32Array.from([0, 4]);
  const counts = createCutCounts(pages, offsets),
    delta = createCutDelta(pages);
  delta.apply([0, 1]);
  counts.apply(delta);
  assert.equal(counts.totals.uncoveredTriangles, 0);
  // La page perd son emplacement de cache, puis ses octets, puis retrouve les deux.
  offsets[1] = -1;
  counts.touch(1);
  assert.equal(counts.totals.uncoveredTriangles, 6);
  pages[1].array = undefined;
  counts.touch(1);
  assert.equal(counts.totals.uncoveredTriangles, 6, 'un trou compté une fois, pas deux');
  offsets[1] = 8;
  pages[1].array = new Uint32Array(3);
  counts.touch(1);
  assert.deepEqual({ ...counts.totals }, reference(pages, [0, 1], offsets));
  // Une page hors de la coupe ne pèse sur rien, quoi qu'il lui arrive.
  offsets[0] = -1;
  counts.clear();
  counts.touch(0);
  assert.deepEqual({ ...counts.totals }, reference(pages, [], offsets));
});

test('mille images de coupes et de couvertures tirées au sort donnent la passe complète', () => {
  const next = stream(20260917);
  const pages: PageRec[] = [];
  for (let i = 0; i < 24; i++) pages.push(page(1 + Math.floor(next() * 40), next() < 0.3, true));
  const offsets = new Int32Array(pages.length);
  const counts = createCutCounts(pages, offsets),
    delta = createCutDelta(pages);
  let ids: number[] = [];
  for (let image = 0; image < 1000; image++) {
    if (next() < 0.5) {
      // La coupe bouge : une suite croissante, comme la liste compactée que la carte publie.
      ids = [];
      for (let id = 0; id < pages.length; id++) if (next() < 0.5) ids.push(id);
      delta.apply(ids);
      counts.apply(delta);
    } else {
      // La couverture d'une page bascule : le journal des rangs la nomme, et elle seule.
      const id = Math.floor(next() * pages.length);
      if (next() < 0.5) offsets[id] = offsets[id] < 0 ? 0 : -1;
      else pages[id].array = pages[id].array ? undefined : new Uint32Array(3);
      counts.touch(id);
    }
    assert.deepEqual({ ...counts.totals }, reference(pages, ids, offsets), `image ${image}`);
  }
});
