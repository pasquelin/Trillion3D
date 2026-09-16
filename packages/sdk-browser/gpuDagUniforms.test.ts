// A11 : parseDagOutput dimensionne ses tableaux d'avance au lieu d'un spread de tableau typé et d'un
// `push` sans capacité. Oracle : la version d'avant le lot A, dans
// `bench/oracles/residence.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDagOutput } from './gpuDagUniforms.ts';
import { referenceParseDagOutput } from './bench/oracles/residence.mjs';
import type { SelectionResult } from './gpuSelection.ts';

/**
 * Le relevé avec son champ de masque toujours présent. L'oracle n'écrivait la clé que lorsqu'un
 * masque existait ; le relevé réutilisé d'une image à l'autre la porte toujours, à `undefined` quand
 * il n'y a pas de masque, pour que la forme de l'objet ne change pas d'une relecture à l'autre.
 * C'est une différence de forme, jamais de valeur : les deux côtés restent comparés champ par champ.
 */
const champs = (releve: SelectionResult | null) =>
  releve && { ...releve, drawablePageIds: releve.drawablePageIds ?? undefined };

function buffer(header: number[], pageIds: number[], mask: number[] = []) {
  const ints = new Uint32Array(4 + pageIds.length + mask.length);
  ints.set(header, 0);
  ints.set(pageIds, 4);
  ints.set(mask, 4 + pageIds.length);
  return ints.buffer;
}

test('the aborted flag (bit 0 of word 3) makes both implementations return null', () => {
  const buf = buffer([5, 0, 0, 1], [1, 2, 3, 4, 5]);
  assert.equal(parseDagOutput(buf, 0, buf.byteLength, 0), null);
  assert.equal(referenceParseDagOutput(buf, 0, buf.byteLength, 0), null);
});

test('a normal readback without a mask matches the reference field for field', () => {
  const buf = buffer([3, 42, 2, 0], [10, 20, 30]);
  const optimisee = parseDagOutput(buf, 0, buf.byteLength, 0);
  const reference = referenceParseDagOutput(buf, 0, buf.byteLength, 0);
  assert.deepEqual(champs(optimisee), champs(reference));
  assert.deepEqual(champs(optimisee), {
    pageIds: [10, 20, 30],
    frustumRejected: 42,
    lodLevel: 2,
    complete: true,
    drawablePageIds: undefined,
  });
});

test('the incomplete flag (bit 1 of word 3) is reported the same way by both sides', () => {
  const buf = buffer([1, 0, 0, 2], [7]);
  assert.deepEqual(parseDagOutput(buf, 0, buf.byteLength, 0)!.complete, false);
  assert.deepEqual(referenceParseDagOutput(buf, 0, buf.byteLength, 0).complete, false);
});

test('a page count larger than the buffer holds is clamped identically, with and without a mask', () => {
  const buf = buffer([1000, 0, 0, 0], [1, 2, 3]);
  const optimisee = parseDagOutput(buf, 0, buf.byteLength, 0);
  const reference = referenceParseDagOutput(buf, 0, buf.byteLength, 0);
  assert.deepEqual(champs(optimisee), champs(reference));
  assert.equal(optimisee!.pageIds.length, 3);
});

test('a drawable-page mask matches the reference verdict for every page, dense and sparse alike', () => {
  const mask = [1, 0, 1, 1, 0, 0, 1, 0];
  const buf = buffer([2, 0, 0, 0], [5, 6], mask);
  const optimisee = parseDagOutput(buf, 0, buf.byteLength, mask.length);
  const reference = referenceParseDagOutput(buf, 0, buf.byteLength, mask.length);
  assert.deepEqual(champs(optimisee), champs(reference));
  assert.deepEqual(optimisee!.drawablePageIds, [0, 2, 3, 6]);
});

test('an empty buffer (all zero) and a zero-length byte range never crash', () => {
  const empty = new ArrayBuffer(16);
  assert.deepEqual(
    champs(parseDagOutput(empty, 0, 16, 0)),
    champs(referenceParseDagOutput(empty, 0, 16, 0)),
  );
  const tiny = new ArrayBuffer(0);
  assert.deepEqual(
    champs(parseDagOutput(tiny, 0, 0, 0)),
    champs(referenceParseDagOutput(tiny, 0, 0, 0)),
  );
});
