import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { splitOccludersFlat } from './hizSplit.ts';

const keyDouble = new Float64Array(1),
  keyWords = new Uint32Array(keyDouble.buffer);

/** L'image ordonnable d'une profondeur : ce sur quoi le partage ordonne, et rien d'autre. La
 *  profondeur du moteur est inversée — le plus proche est le plus grand —, donc la clé est celle de
 *  l'OPPOSÉ, et l'ordre croissant des clés reste celui du plus proche au plus lointain. */
function orderable(value: number) {
  keyDouble[0] = -value;
  const low = keyWords[0],
    high = keyWords[1];
  const negative = (high & 0x80000000) !== 0;
  return {
    low: negative ? ~low >>> 0 : low,
    high: negative ? ~high >>> 0 : (high ^ 0x80000000) >>> 0,
  };
}

/**
 * La moitié la plus proche telle que le tri stable la donnait : les candidats classés sur la clé
 * ordonnable, les égalités départagées par leur indice, puis la première moitié. C'est la référence
 * que la sélection doit rendre terme pour terme.
 */
function moitieTriee(count: number, bounds: Float64Array) {
  const candidates: number[] = [];
  for (let i = 0; i < count; i++) if (bounds[i * HIZ_BOUNDS_VALUES + 5] === 0) candidates.push(i);
  const rest = new Uint8Array(count).fill(1);
  if (!candidates.length) return { rest, occluders: 0 };
  const keys = new Map(candidates.map((i) => [i, orderable(bounds[i * HIZ_BOUNDS_VALUES + 4])]));
  candidates.sort((a, b) => {
    const ka = keys.get(a)!,
      kb = keys.get(b)!;
    return ka.high - kb.high || ka.low - kb.low || a - b;
  });
  const occluders = Math.max(1, Math.floor(candidates.length / 2));
  for (let i = 0; i < occluders; i++) rest[candidates[i]] = 0;
  return { rest, occluders };
}

/** Une coupe décrite par ses seules profondeurs ; `null` coupe le plan proche. */
function bounds(depths: readonly (number | null)[]) {
  const flat = new Float64Array(Math.max(1, depths.length) * HIZ_BOUNDS_VALUES);
  for (let i = 0; i < depths.length; i++) {
    const depth = depths[i];
    flat[i * HIZ_BOUNDS_VALUES + 5] = depth === null ? 1 : 0;
    flat[i * HIZ_BOUNDS_VALUES + 4] = depth ?? 0;
  }
  return flat;
}

function memeEnsemble(depths: readonly (number | null)[], why: string) {
  const flat = bounds(depths);
  const attendu = moitieTriee(depths.length, flat);
  const obtenu = new Uint8Array(Math.max(1, depths.length));
  const occluders = splitOccludersFlat(depths.length, flat, obtenu);
  assert.equal(occluders, attendu.occluders, `nombre d'occulteurs — ${why}`);
  assert.deepEqual(
    [...obtenu.subarray(0, depths.length)],
    [...attendu.rest],
    `moitié la plus proche — ${why}`,
  );
}

test('la sélection de la moitié la plus proche rend l’ensemble du tri stable', () => {
  memeEnsemble([], 'aucune boîte');
  memeEnsemble([null, null], 'toutes coupent le plan proche');
  memeEnsemble([0.5], 'une seule boîte');
  memeEnsemble([0.9, 0.1, 0.5, 0.3], 'profondeurs distinctes');
  memeEnsemble([0.4, 0.4, 0.4, 0.4, 0.4], 'toutes égales : l’indice départage');
  memeEnsemble([0.2, null, 0.2, 0.1, null, 0.9], 'égalités et coupes mêlées');
  memeEnsemble([-0, 0, -0, 0], 'zéro signé : les deux ne sont pas la même clé');
  memeEnsemble([Infinity, -Infinity, 0, NaN, 1e-320, -1e-320], 'valeurs extrêmes');
  memeEnsemble([NaN, NaN, 1, 2], 'NaN, qu’aucune comparaison numérique n’ordonne');
});

test('la sélection tient sur des coupes larges, à clés rares comme à clés denses', () => {
  let seed = 20260916;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const distinct of [1, 2, 7, 1000, 0]) {
    const count = 4000;
    const depths: (number | null)[] = [];
    for (let i = 0; i < count; i++)
      depths.push(
        rand() < 0.1
          ? null
          : distinct === 0
            ? rand() * 2 - 1
            : Math.floor(rand() * distinct) / distinct,
      );
    memeEnsemble(depths, `${count} boîtes, ${distinct || 'toutes'} clés`);
  }
});
