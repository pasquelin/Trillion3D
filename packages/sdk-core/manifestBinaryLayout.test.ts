// Lot F, F19 : `writeSha` (manifestBinaryLayout.ts) validait l'empreinte avec une expression
// régulière puis la parcourait une seconde fois pour l'écrire. Elle lit désormais chaque code une
// fois, dans une réserve partagée, et ne pose l'empreinte qu'une fois les 64 caractères acceptés.
// L'oracle est l'implémentation d'avant le lot F, recopiée telle quelle dans `oracles/f-manifeste.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSha } from './manifestBinaryLayout.ts';
import { referenceWriteSha } from '../../scripts/mesure/calculs/oracles/f-manifeste.mjs';

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function bothThrow(sha: string) {
  let threwNeuf = false,
    threwRef = false;
  try {
    writeSha(new Uint8Array(64), 0, sha);
  } catch {
    threwNeuf = true;
  }
  try {
    referenceWriteSha(new Uint8Array(64), 0, sha);
  } catch {
    threwRef = true;
  }
  return { threwNeuf, threwRef };
}

test('une empreinte valide de 64 hex minuscules écrit les mêmes octets que la référence', () => {
  for (const sha of [
    VALID,
    '0'.repeat(64),
    'f'.repeat(64),
    '0123456789abcdef'.repeat(4),
    '9'.repeat(64),
  ]) {
    const target = new Uint8Array(128),
      reference = new Uint8Array(128);
    writeSha(target, 1, sha);
    referenceWriteSha(reference, 1, sha);
    for (let i = 0; i < target.length; i++)
      assert.ok(Object.is(target[i], reference[i]), `octet ${i} pour ${sha}`);
  }
});

test('une empreinte hostile (longueur, casse, caractère hors hex) est refusée des deux côtés, sans écrire', () => {
  const hostiles = [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64), // majuscules : hors [0-9a-f]
    `${'a'.repeat(63)}g`, // un caractère hors hex à la dernière position
    `z${'a'.repeat(63)}`, // ... à la première position
    `${'a'.repeat(32)} ${'a'.repeat(31)}`, // un espace au milieu
    '/'.repeat(64), // juste avant '0' (0x2f)
    ':'.repeat(64), // juste après '9' (0x3a)
    '`'.repeat(64), // juste avant 'a' (0x60)
    'g'.repeat(64), // juste après 'f' (0x67)
  ];
  for (const sha of hostiles) {
    const { threwNeuf, threwRef } = bothThrow(sha);
    assert.equal(threwNeuf, true, `writeSha aurait dû refuser ${JSON.stringify(sha)}`);
    assert.equal(threwRef, true, `la référence aurait dû refuser ${JSON.stringify(sha)}`);
    // Aucune écriture ne doit survivre à un refus : la cible reste à zéro.
    const target = new Uint8Array(64);
    try {
      writeSha(target, 0, sha);
    } catch {
      // attendu
    }
    assert.ok(
      target.every((byte) => byte === 0),
      `writeSha a écrit malgré le refus pour ${JSON.stringify(sha)}`,
    );
  }
});

test('les 16 chiffres hexadécimaux couvrent chaque position sans altérer les octets voisins', () => {
  const target = new Uint8Array(192).fill(0xff);
  const reference = new Uint8Array(192).fill(0xff);
  writeSha(target, 1, VALID);
  referenceWriteSha(reference, 1, VALID);
  for (let i = 0; i < target.length; i++)
    assert.ok(Object.is(target[i], reference[i]), `octet ${i} : bordure du créneau 1`);
});

test('deux empreintes valides écrites à la suite ne se mélangent pas dans la réserve partagée', () => {
  const shaA = '0'.repeat(64),
    shaB = 'f'.repeat(64);
  const target = new Uint8Array(128),
    reference = new Uint8Array(128);
  writeSha(target, 0, shaA);
  writeSha(target, 1, shaB);
  referenceWriteSha(reference, 0, shaA);
  referenceWriteSha(reference, 1, shaB);
  for (let i = 0; i < target.length; i++)
    assert.ok(Object.is(target[i], reference[i]), `octet ${i}`);
  // Une écriture refusée entre les deux ne doit pas laisser de trace dans le créneau suivant.
  assert.throws(() => writeSha(target, 2, 'z'.repeat(64)));
  assert.ok(
    target.subarray(128).every((byte) => byte === 0),
    'le créneau 2, jamais écrit, reste à zéro',
  );
});
