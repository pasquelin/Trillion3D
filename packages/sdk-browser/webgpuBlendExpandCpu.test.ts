import test from 'node:test';
import assert from 'node:assert/strict';
import { blendChunkWords, blendVertexShift, RUN_WORDS } from './webgpuBlendRuns.ts';
import { expandBlendPlan, itemKept } from './webgpuBlendExpandCpu.ts';
import { DRAW_UNPAGED, planEntry } from './webgpuBlendPlan.ts';

/** Une entrée de plan : le rang de l'item, le bit de partage, le pipeline. */
const entree = (item: number, shared: boolean, pipeline = 1) => planEntry(item, pipeline, shared);

/** Le décor minimal d'un étalement : trois items paginés d'un côté, une primitive isolée. */
function decor() {
  const draws = new Uint32Array(4 * 4);
  for (let item = 0; item < 3; item++) {
    draws[item * 4] = item;
    draws[item * 4 + 1] = 4;
    draws[item * 4 + 2] = item * 4;
  }
  // Le quatrième porte ses propres indices : dix-huit mots, six par instance, donc trois morceaux.
  draws[12] = DRAW_UNPAGED;
  draws[13] = 3;
  draws[15] = 6;
  const instances = Uint32Array.from({ length: 12 }, (_, k) => 100 + k);
  return {
    draws,
    instances,
    itemCounts: Uint32Array.from([2, 3, 1]),
    keep: Uint32Array.from([0b1111]),
    expanded: new Uint32Array(64),
    args: new Uint32Array(16),
    maxVertexWords: 48,
    vertexShift: 6,
    instanceBase: 0,
    argsBase: 0,
  };
}

test('une tranche partagée étale les instances de ses entrées, dans l’ordre du plan', () => {
  const base = decor();
  const order = Uint32Array.from([entree(2, true), entree(0, true), entree(1, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 3]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 6, 'un + deux + trois grappes');
  // L'item qui porte chaque instance, puis l'entrée de table que la compaction lui a gardée.
  assert.deepEqual(
    Array.from(base.expanded.subarray(0, 12)),
    [2, 108, 0, 100, 0, 101, 1, 104, 1, 105, 1, 106],
  );
  // Un seul argument indirect : les sommets d'une grappe, les six instances, et le sommet de départ
  // qui porte le rang de la première instance dans ses bits hauts.
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [48, 6, 0, 0]);
});

test('un item que le tronc rejette n’étale aucune instance, et ne décale pas les autres', () => {
  const base = decor();
  base.keep[0] = 0b1101;
  const order = Uint32Array.from([entree(0, true), entree(1, true), entree(2, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 3]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 3, 'les deux grappes du rang 0 et la grappe du rang 2');
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [0, 100, 0, 101, 2, 108]);
  assert.equal(base.args[1], 3);
});

test('une primitive non paginée s’étale en morceaux d’un pas d’indices', () => {
  const base = decor();
  const order = Uint32Array.from([entree(3, false)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 1]);
  const total = expandBlendPlan({ ...base, order, runs, runCount: 1 });
  assert.equal(total, 3, 'dix-huit mots d’indices, six par instance');
  // Chaque instance dit où son morceau commence ; le nuanceur en tire sa longueur.
  assert.deepEqual(Array.from(base.expanded.subarray(0, 6)), [3, 0, 3, 6, 3, 12]);
  // Une tranche d'un seul item non paginé dessine SES sommets, pas ceux d'une grappe.
  assert.deepEqual(Array.from(base.args.subarray(0, 4)), [6, 3, 0, 0]);
});

test('les deux passes étalent dans deux régions disjointes, chacune à sa base', () => {
  const base = decor();
  const order = Uint32Array.from([entree(0, true)]);
  const runs = new Uint32Array(RUN_WORDS);
  runs.set([0, 1]);
  expandBlendPlan({ ...base, order, runs, runCount: 1, instanceBase: 5, argsBase: 8 });
  assert.deepEqual(Array.from(base.expanded.subarray(10, 14)), [0, 100, 0, 101]);
  // Le sommet de départ porte le rang absolu de la première instance : cinq, décalé du pas.
  assert.deepEqual(Array.from(base.args.subarray(8, 12)), [48, 2, 5 << 6, 0]);
});

test('le pas d’adressage tient la plus longue instance, et le morceau reste un multiple de trois', () => {
  for (const mots of [3, 48, 384, 385, 4096]) {
    const shift = blendVertexShift(mots);
    assert.ok(1 << shift >= mots, `${mots} mots tiennent dans le pas`);
    const chunk = blendChunkWords(shift, 10000);
    assert.equal(chunk % 3, 0, 'un morceau ne coupe jamais un triangle');
    assert.ok(chunk <= 1 << shift, 'un morceau tient dans le pas');
  }
  // Une primitive plus courte que le pas n'est pas découpée : un seul morceau, ses sommets exacts.
  assert.equal(blendChunkWords(9, 384), 384);
});

test('le verdict du tronc se lit bit à bit, au rang de l’item', () => {
  const keep = Uint32Array.from([0b1010, 0b0001]);
  assert.deepEqual(
    [0, 1, 2, 3, 32, 33].map((item) => itemKept(keep, item)),
    [false, true, false, true, true, false],
  );
});
