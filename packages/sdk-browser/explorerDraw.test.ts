// Batch F, F13: `anneauFroid` (explorerDraw.ts) stops as soon as the batch is full instead of
// filtering the whole ring before keeping its head (`.filter(...).slice(0, limite)`). The oracle
// is the whole filter from before batch F, copied as-is into `oracles/cadre-vue.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anneauFroid, empileEnAttente } from './explorerDraw.ts';
import { referenceAnneauFroid } from '../../bench/oracles/browser/cadre-vue.ts';
import { referenceEmpileEnAttente } from '../../bench/oracles/browser/recherches-streaming.ts';

function streamer(has: Set<string>, loading: Set<string>, failed: Set<string>) {
  return {
    has: (url: string) => has.has(url),
    loading: (url: string) => loading.has(url),
    failed: (url: string) => failed.has(url),
  };
}

test('an empty ring yields an empty batch on both sides', () => {
  const s = streamer(new Set(), new Set(), new Set());
  assert.deepEqual(anneauFroid([], s, 5), referenceAnneauFroid([], s, 5));
});

test('a limit of zero never takes anything, even on a non-empty ring', () => {
  const s = streamer(new Set(), new Set(), new Set());
  const ring = ['a', 'b', 'c'];
  assert.deepEqual(anneauFroid(ring, s, 0), referenceAnneauFroid(ring, s, 0));
});

test('the whole ring already held, in flight or failed yields nothing', () => {
  const ring = ['a', 'b', 'c', 'd'];
  const s = streamer(new Set(['a']), new Set(['b']), new Set(['c', 'd']));
  assert.deepEqual(anneauFroid(ring, s, 10), referenceAnneauFroid(ring, s, 10));
});

test('the limit cuts at exactly the same address as the reference filter then slice', () => {
  const ring = Array.from({ length: 20 }, (_, i) => `u${i}`);
  const s = streamer(new Set(['u0', 'u5', 'u10']), new Set(['u2']), new Set(['u7']));
  for (const limite of [1, 2, 3, 17])
    assert.deepEqual(
      anneauFroid(ring, s, limite),
      referenceAnneauFroid(ring, s, limite),
      `limite ${limite}`,
    );
});

test('a cold address at the very last rank of the ring, with a wide limit, is still taken', () => {
  const ring = Array.from({ length: 50 }, (_, i) => `u${i}`);
  const chaud = new Set(ring.slice(0, 49));
  const s = streamer(chaud, new Set(), new Set());
  assert.deepEqual(anneauFroid(ring, s, 50), referenceAnneauFroid(ring, s, 50));
  assert.deepEqual(anneauFroid(ring, s, 50), ['u49']);
});

test('a large ring, a large number of batches of varied sizes, stays identical to the reference', () => {
  const ring = Array.from({ length: 5000 }, (_, i) => `u${i}`);
  const chaud = new Set(ring.filter((_, i) => i % 3 === 0));
  const enCours = new Set(ring.filter((_, i) => i % 7 === 0));
  const echec = new Set(ring.filter((_, i) => i % 11 === 0));
  const s = streamer(chaud, enCours, echec);
  for (const limite of [1, 64, 512, 4999, 5000, 100000])
    assert.deepEqual(
      anneauFroid(ring, s, limite),
      referenceAnneauFroid(ring, s, limite),
      `limite ${limite}`,
    );
});

// G6: missing addresses that an in-flight request will send again later accumulate in a
// `Set` (`empileEnAttente`) instead of an array tested by `includes` on every added address.
// Oracle: the hand-deduped array from before batch G, copied into `../../bench/oracles/browser/recherches-streaming.ts`.
test('an empty set receives the same addresses, in the same order, as a hand-deduped array', () => {
  const ensemble = new Set<string>();
  const tableau: string[] = [];
  empileEnAttente(ensemble, ['a', 'b', 'c']);
  referenceEmpileEnAttente(tableau, ['a', 'b', 'c']);
  assert.deepEqual([...ensemble], tableau);
});

test('duplicates inside one call, and between two calls, are counted only once', () => {
  const ensemble = new Set<string>();
  const tableau: string[] = [];
  for (const lot of [['a', 'a', 'b'], ['b', 'c', 'a'], [], ['d']]) {
    empileEnAttente(ensemble, lot);
    referenceEmpileEnAttente(tableau, lot);
  }
  assert.deepEqual([...ensemble], tableau);
  assert.deepEqual([...ensemble], ['a', 'b', 'c', 'd']);
});

test('a large number of partly redundant addresses keeps the same insertion order as the reference', () => {
  const ensemble = new Set<string>();
  const tableau: string[] = [];
  const lot = Array.from({ length: 2000 }, (_, i) => `u${i % 700}`);
  empileEnAttente(ensemble, lot);
  referenceEmpileEnAttente(tableau, lot);
  assert.deepEqual([...ensemble], tableau);
});
