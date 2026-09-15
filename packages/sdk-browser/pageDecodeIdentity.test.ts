// Lot H2 : les trois chemins de décodage — WebAssembly, JavaScript, et la tâche du contrat exécutée
// sur place — doivent rendre exactement les mêmes octets, ou refuser pour la même cause. Entrées
// hostiles : 65 535 sommets (la borne haute), du NaN/Infinity glissé après coup, une page tronquée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { decodeGeometryPageWasm, prepareGeometryPageWasm } from './geometryPageWasm.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import { runPageDecodeTask } from './pageDecodeTask.ts';
import type { PageDecodeDone } from '../sdk-core/index.ts';

const MAX = 16 * 1024 * 1024;
const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));

test.before(async () => {
  assert.ok(await prepareGeometryPageWasm(MODULE), 'le module wasm réel doit s’instancier');
});

/** Une valeur identique octet pour octet des trois côtés, ou le premier écart. */
function ecart(nom: string, a: Float32Array | Uint32Array, b: Float32Array | Uint32Array) {
  if (a.length !== b.length) return `${nom}: longueur ${a.length} ≠ ${b.length}`;
  for (let i = 0; i < a.length; i++)
    if (!Object.is(a[i], b[i])) return `${nom}[${i}]: ${a[i]} ≠ ${b[i]}`;
  return null;
}

async function trioIdentique(donnees: Uint8Array) {
  const enPlace = await decodeGeometryPage(donnees.slice(), MAX);
  const parWasm = await decodeGeometryPageWasm(donnees.slice(), MAX);
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 1,
    op: 'decode',
    source: donnees.slice().buffer as ArrayBuffer,
    maxDecodedBytes: MAX,
  });
  assert.equal(answer.ok, true);
  const bon = answer as PageDecodeDone;
  assert.equal(bon.wasm, true, 'le module wasm préchargé doit avoir fait le travail de la tâche');
  assert.equal(ecart('indices en place/wasm', enPlace.indices, parWasm.indices), null);
  for (const nom of Object.keys(enPlace.attributes))
    assert.equal(ecart(nom, enPlace.attributes[nom], parWasm.attributes[nom]), null);
  return enPlace;
}

test('65 535 sommets — la borne haute — décodent à l’identique sur les trois chemins', async () => {
  const sommets = 65535;
  const position = new Float32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) position.set([i * 0.001, -i * 0.001, 0], i * 3);
  const triangles = Math.floor(sommets / 3) * 3,
    indices = new Uint32Array(triangles);
  for (let i = 0; i < triangles; i++) indices[i] = (i * 7919) % sommets;
  const { data } = await encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
  });
  const enPlace = await trioIdentique(data as Uint8Array);
  assert.equal(enPlace.vertexCount, sommets);
});

test('un NaN, un Infinity et un -0 glissés dans la page se décodent ou se refusent à l’identique', async () => {
  const position = new Float32Array([1, 2, 3, -0, 5, 6, 7, 8, 9]);
  const original = Number.isFinite;
  // Le codec de référence refuse tout attribut non fini : on le contourne pour fabriquer une page
  // hostile mais structurellement valide, seule façon de faire passer du NaN par le compresseur.
  Object.defineProperty(Number, 'isFinite', { value: () => true, configurable: true });
  let data: Uint8Array;
  try {
    const avecNaN = new Float32Array([1, 2, 3, Number.NaN, 5, 6, Number.POSITIVE_INFINITY, 8, 9]);
    ({ data } = (await encodeGeometryPage([0, 1, 2], {
      POSITION: { itemSize: 3, array: avecNaN },
    })) as { data: Uint8Array });
  } finally {
    Object.defineProperty(Number, 'isFinite', { value: original, configurable: true });
  }
  await assert.rejects(() => decodeGeometryPage(data.slice(), MAX), /GEOMETRY_PAGE_NONFINITE/);
  await assert.rejects(() => decodeGeometryPageWasm(data.slice(), MAX), /GEOMETRY_PAGE_NONFINITE/);

  // Le -0 seul, lui, est fini : il traverse l'encodeur normalement et doit rester -0, pas 0, partout.
  const { data: propre } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
  });
  const enPlace = await trioIdentique(propre as Uint8Array);
  assert.ok(Object.is(enPlace.attributes.position[3], -0));
});

test('une page tronquée après son en-tête refuse GEOMETRY_PAGE_BOUNDS sur les trois chemins', async () => {
  const { data } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  const tronquee = (data as Uint8Array).slice(0, 32 + 4); // l'en-tête accepté, le corps coupé.
  await assert.rejects(() => decodeGeometryPage(tronquee.slice(), MAX), /GEOMETRY_PAGE_BOUNDS/);
  await assert.rejects(() => decodeGeometryPageWasm(tronquee.slice(), MAX), /GEOMETRY_PAGE_BOUNDS/);
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 2,
    op: 'decode',
    source: tronquee.slice().buffer as ArrayBuffer,
    maxDecodedBytes: MAX,
  });
  assert.equal(answer.ok, false);
  assert.equal((answer as { code: string }).code, 'GEOMETRY_PAGE_BOUNDS');
});
