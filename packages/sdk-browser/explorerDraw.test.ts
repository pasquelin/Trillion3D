// Lot F, F13 : `anneauFroid` (explorerDraw.ts) s'arrête dès que le lot est plein au lieu de filtrer
// l'anneau entier avant d'en garder la tête (`.filter(...).slice(0, limite)`). L'oracle est le filtre
// entier d'avant le lot F, recopié tel quel dans `oracles/f-cadre.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anneauFroid } from './explorerDraw.ts';
import { referenceAnneauFroid } from './bench/oracles/f-cadre.mjs';

function streamer(has: Set<string>, loading: Set<string>, failed: Set<string>) {
  return {
    has: (url: string) => has.has(url),
    loading: (url: string) => loading.has(url),
    failed: (url: string) => failed.has(url),
  };
}

test('un anneau vide rend un lot vide des deux côtés', () => {
  const s = streamer(new Set(), new Set(), new Set());
  assert.deepEqual(anneauFroid([], s, 5), referenceAnneauFroid([], s, 5));
});

test('une limite de zéro ne prend jamais rien, même sur un anneau non vide', () => {
  const s = streamer(new Set(), new Set(), new Set());
  const ring = ['a', 'b', 'c'];
  assert.deepEqual(anneauFroid(ring, s, 0), referenceAnneauFroid(ring, s, 0));
});

test('tout l’anneau déjà détenu, en cours ou en échec ne rend rien', () => {
  const ring = ['a', 'b', 'c', 'd'];
  const s = streamer(new Set(['a']), new Set(['b']), new Set(['c', 'd']));
  assert.deepEqual(anneauFroid(ring, s, 10), referenceAnneauFroid(ring, s, 10));
});

test('la limite coupe exactement à la même adresse que le filtre puis slice de la référence', () => {
  const ring = Array.from({ length: 20 }, (_, i) => `u${i}`);
  const s = streamer(new Set(['u0', 'u5', 'u10']), new Set(['u2']), new Set(['u7']));
  for (const limite of [1, 2, 3, 17])
    assert.deepEqual(
      anneauFroid(ring, s, limite),
      referenceAnneauFroid(ring, s, limite),
      `limite ${limite}`,
    );
});

test('une adresse froide au tout dernier rang de l’anneau, avec une limite large, est quand même prise', () => {
  const ring = Array.from({ length: 50 }, (_, i) => `u${i}`);
  const chaud = new Set(ring.slice(0, 49));
  const s = streamer(chaud, new Set(), new Set());
  assert.deepEqual(anneauFroid(ring, s, 50), referenceAnneauFroid(ring, s, 50));
  assert.deepEqual(anneauFroid(ring, s, 50), ['u49']);
});

test('un grand anneau, un grand nombre de lots de tailles variées, reste identique à la référence', () => {
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
