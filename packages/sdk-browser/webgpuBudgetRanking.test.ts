// Le classement du budget de pages ne parcourt plus la coupe : les clés pesées sont rangées par
// niveau à mesure qu'elles entrent et sortent, et le préfixe se lit des niveaux les plus grossiers
// jusqu'au budget. Ce qu'il contient est inchangé en nature — les niveaux grossiers entiers, puis
// autant du niveau qui chevauche le budget que celui-ci en porte, et rien de plus fin.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createBudgetRanking } from './webgpuBudgetRanking.ts';

const keyOf = (page: PageRec) => page.keyIndex as number;
const rec = (key: number, level: number | undefined, tag: string) =>
  ({ url: tag, keyIndex: key, level }) as unknown as PageRec;

/** Pages the budget weighs: the cut's distinct keys, the cover excluded. */
const weighed = (cut: readonly PageRec[], cover: Uint8Array) =>
  new Set(cut.filter((page) => !cover[keyOf(page)]).map(keyOf));

/** Ce que le préfixe doit contenir, niveau par niveau : les grossiers entiers, puis le reste du
 *  budget pris au niveau qui le chevauche, et rien en dessous. Un ensemble par niveau, pas un
 *  ordre : l'ordre interne d'un niveau est celui des entrées, et il n'est plus une promesse. */
function reference(cut: readonly PageRec[], cover: Uint8Array, room: number) {
  const byLevel = new Map<number, Set<number>>();
  for (const page of cut) {
    const key = keyOf(page);
    if (cover[key]) continue;
    const level = page.level ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, new Set());
    byLevel.get(level)!.add(key);
  }
  const levels = [...byLevel.keys()].sort((a, b) => b - a);
  const taken = new Map<number, number>();
  let left = room;
  for (const level of levels) {
    const size = byLevel.get(level)!.size;
    taken.set(level, Math.min(size, left));
    left = Math.max(0, left - size);
  }
  return { byLevel, taken };
}

/** Le préfixe rendu, vérifié contre la référence : compte par niveau, appartenance, unicité. */
function check(
  ranking: ReturnType<typeof createBudgetRanking>,
  cut: readonly PageRec[],
  cover: Uint8Array,
  room: number,
  label: string,
) {
  const records = ranking.rank(room);
  assert.equal(records, weighed(cut, cover).size, `${label} : pages pesées`);
  if (records <= room) return;
  const want = reference(cut, cover, room);
  const keys = [...ranking.keys.subarray(0, ranking.length)];
  assert.equal(keys.length, room, `${label} : le préfixe vaut le budget`);
  assert.equal(new Set(keys).size, room, `${label} : une entrée par page`);
  const counted = new Map<number, number>();
  keys.forEach((key, index) => {
    const page = ranking.ranked[index];
    assert.equal(keyOf(page), key, `${label} : l'enregistrement est celui de la clé`);
    const level = page.level ?? 0;
    assert.ok(want.byLevel.get(level)?.has(key), `${label} : clé pesée à son niveau`);
    counted.set(level, (counted.get(level) ?? 0) + 1);
  });
  for (const [level, count] of want.taken)
    assert.equal(counted.get(level) ?? 0, count, `${label} : pages prises au niveau ${level}`);
}

/** A reproducible pseudo-random stream: the sweep below has to be the same on every run. */
function stream(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

test('le préfixe garde les niveaux grossiers entiers et coupe dans celui qui chevauche', () => {
  const next = stream(20260915);
  for (let trial = 0; trial < 200; trial++) {
    const keyCount = 1 + Math.floor(next() * 40);
    const cover = new Uint8Array(keyCount);
    for (let key = 0; key < keyCount; key++) cover[key] = next() < 0.2 ? 1 : 0;
    // A level belongs to the page, not to the placement: two placements of one cluster are the same
    // cluster, at the same level, in one cache slot.
    const levels = Array.from({ length: keyCount }, () =>
      next() < 0.1 ? undefined : Math.floor(next() * 13),
    );
    const cut: PageRec[] = [];
    const count = Math.floor(next() * 120);
    for (let i = 0; i < count; i++) {
      const key = Math.floor(next() * keyCount);
      cut.push(rec(key, levels[key], `p${i}`));
    }
    const room = Math.floor(next() * (count + 3));
    const ranking = createBudgetRanking({ keyCount, bootstrapKey: cover, keyOf });
    for (const page of cut) ranking.add(page);
    check(ranking, cut, cover, room, `essai ${trial}`);
  }
});

test('a placement that leaves is subtracted, and the rank follows the cut that remains', () => {
  const cover = new Uint8Array(6);
  cover[0] = 1;
  const cut = [
    rec(0, 3, 'cover'),
    rec(1, 0, 'fine-a'),
    rec(2, 2, 'coarse-a'),
    rec(3, 1, 'mid'),
    rec(2, 2, 'coarse-a-again'),
    rec(4, 2, 'coarse-b'),
  ];
  const ranking = createBudgetRanking({ keyCount: 6, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  // Four pages, not five placements: the two `coarse-a` records share one slot.
  assert.equal(ranking.rank(3), 4);
  // Coarsest first, entry order inside a level, one entry per page.
  assert.deepEqual([...ranking.keys.subarray(0, ranking.length)], [2, 4, 3]);
  // The two coarse-a placements leave; what is left is mid then fine, and it now fits.
  ranking.remove(cut[2]);
  ranking.remove(cut[4]);
  assert.equal(ranking.rank(3), 3);
  assert.equal(ranking.pageCount, 3);
  assert.equal(ranking.rank(2), 3);
  assert.deepEqual([...ranking.keys.subarray(0, ranking.length)], [4, 3]);
});

test('un classement que rien ne fait bouger rend deux fois le même préfixe', () => {
  const cover = new Uint8Array(8);
  const cut = [0, 1, 2, 3, 4, 5, 6, 7].map((key) => rec(key, key % 3, `p${key}`));
  const ranking = createBudgetRanking({ keyCount: 8, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  ranking.rank(5);
  const premier = [...ranking.keys.subarray(0, ranking.length)],
    pages = ranking.ranked.slice(0, ranking.length);
  ranking.rank(5);
  assert.deepEqual([...ranking.keys.subarray(0, ranking.length)], premier, 'même ordre');
  assert.equal(
    ranking.matches(Int32Array.from(premier), premier.length, pages),
    true,
    'la file qui tient déjà ce préfixe est reconnue, donc jamais réécrite',
  );
  assert.equal(ranking.matches(Int32Array.from(premier), 4, pages), false, 'longueur différente');
});

test('levels beyond the first band grow the counters without disturbing the rank', () => {
  const cover = new Uint8Array(3);
  const cut = [rec(0, 0, 'zero'), rec(1, 40, 'haut'), rec(2, 9, 'milieu')];
  const ranking = createBudgetRanking({ keyCount: 3, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  check(ranking, cut, cover, 2, 'niveaux hauts');
  assert.deepEqual([...ranking.keys.subarray(0, ranking.length)], [1, 2]);
});
