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
 *
 * `truncated` est ÔTÉ de la comparaison : c'est le seul champ que l'oracle ne peut pas porter, le
 * bit 0 ayant changé de sens avec le plafond du relevé. Il est asserté à part, juste en dessous.
 */
const champs = (releve: SelectionResult | null) => {
  if (!releve) return releve;
  const { truncated: _truncated, ...reste } = releve;
  return { ...reste, drawablePageIds: releve.drawablePageIds ?? undefined };
};

function buffer(header: number[], pageIds: number[]) {
  const ints = new Uint32Array(4 + pageIds.length);
  ints.set(header, 0);
  ints.set(pageIds, 4);
  return ints.buffer;
}

/** Le relevé tel que la carte graphique le rend : l'entête et les pages, puis la liste compactée. */
function withDrawn(header: number[], pageIds: number[], drawn: number[], pageCount: number) {
  const words = 4 + pageCount;
  const ints = new Uint32Array(words * 2);
  ints.set(header, 0);
  ints.set(pageIds, 4);
  ints[words] = drawn.length;
  ints.set(drawn, words + 4);
  return { bytes: ints.buffer, drawnWordOffset: words };
}

// Le bit 0 a changé de sens avec le plafond du relevé (`gpuDagLayout.ts`). Il disait « la coupe a
// écrit plus de rangs qu'il n'existe de grappes », c'est-à-dire une panne, et l'oracle rendait
// `null` : la sélection GPU était abandonnée pour la session. Il dit maintenant « la coupe ne tenait
// pas sous le plafond », ce qui est une situation NORMALE d'une scène extrême : les noyaux ont
// tourné, le masque de l'image est juste, seule la LISTE est amputée. Le relevé est donc rendu, et
// marqué, pour que l'image repasse par la coupe processeur au lieu de mourir.
test('le bit 0 du mot 3 déclare le relevé tronqué, sans le jeter', () => {
  const buf = buffer([5, 0, 0, 1], [1, 2, 3, 4, 5]);
  const releve = parseDagOutput(buf, 0, buf.byteLength, 0);
  assert.ok(releve, 'un relevé tronqué reste un relevé');
  assert.equal(releve.truncated, true);
  assert.deepEqual(releve.pageIds, [1, 2, 3, 4, 5]);
  assert.equal(referenceParseDagOutput(buf, 0, buf.byteLength, 0), null, 'ce que faisait l’oracle');
});

test('un relevé qui tient sous le plafond n’est jamais déclaré tronqué', () => {
  const buf = buffer([3, 0, 0, 0], [10, 20, 30]);
  assert.equal(parseDagOutput(buf, 0, buf.byteLength, 0)!.truncated, false);
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

test('la liste dessinable compactée est relue telle quelle, sans parcourir toutes les pages', () => {
  const { bytes, drawnWordOffset } = withDrawn([2, 0, 0, 0], [5, 6], [0, 2, 3, 6], 8);
  const releve = parseDagOutput(bytes, 0, bytes.byteLength, drawnWordOffset);
  assert.deepEqual(releve!.pageIds, [5, 6]);
  assert.deepEqual(releve!.drawablePageIds, [0, 2, 3, 6]);
});

test('un compte dessinable plus grand que le relevé est ramené à ce qu il contient', () => {
  const { bytes, drawnWordOffset } = withDrawn([1, 0, 0, 0], [5], [1, 2], 4);
  const ints = new Uint32Array(bytes);
  ints[drawnWordOffset] = 1000;
  const releve = parseDagOutput(bytes, 0, bytes.byteLength, drawnWordOffset);
  assert.equal(releve!.drawablePageIds!.length, 4);
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
