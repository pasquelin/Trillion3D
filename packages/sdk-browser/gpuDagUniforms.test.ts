// A11 : parseDagOutput dimensionne ses tableaux d'avance au lieu d'un spread de tableau typé et d'un
// `push` sans capacité. Oracle : la version d'avant le lot A, dans `bench/oracles/residence.mjs`.
//
// L'ENTÊTE A CHANGÉ DE LARGEUR depuis : quatre mots d'abord — un compte, le rejet par le tronc, le
// niveau, les drapeaux —, huit désormais, les quatre suivants portant les totaux de triangles que la
// carte tient (`gpuDagLayout.ts`). L'oracle est figé sur quatre. Chaque côté reçoit donc un relevé
// DANS SA PROPRE DISPOSITION, avec les mêmes valeurs, et la comparaison porte sur ce qu'ils en
// tirent : c'est le décodage qui est comparé, pas le placement des mots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDagOutput } from './gpuDagUniforms.ts';
import { SELECTION_HEADER_WORDS } from './gpuDagLayout.ts';
import { REQUEST_PRIORITY_MAX, packRequest } from './gpuDagRequest.ts';
import { referenceParseDagOutput } from './bench/oracles/residence.mjs';
import type { SelectionResult } from './gpuSelection.ts';

/** L'entête de l'oracle : quatre mots, ceux d'avant les totaux. */
const HEAD_ORACLE = 4;

/**
 * Le relevé réduit à ce que les deux côtés peuvent porter. `drawablePageIds` est normalisé — l'oracle
 * n'écrivait la clé que lorsqu'un masque existait, le relevé réutilisé la porte toujours. Les champs
 * que l'un des deux seulement produit — `truncated`, `requestPriorities` que seul l'oracle publie,
 * et les quatre totaux — sont ÔTÉS et assertés à part : les comparer reviendrait à demander à un
 * côté ce qu'il n'a jamais su.
 */
const champs = (releve: SelectionResult | null) => {
  if (!releve) return releve;
  const {
    truncated: _t,
    requestPriorities: _r,
    selectedTriangles: _s,
    drawnTriangles: _d,
    uncoveredTriangles: _u,
    transparentTriangles: _p,
    ...reste
  } = releve;
  return { ...reste, drawablePageIds: releve.drawablePageIds ?? undefined };
};

function buffer(header: number[], pageIds: number[], head = SELECTION_HEADER_WORDS) {
  const ints = new Uint32Array(head + pageIds.length);
  ints.set(header, 0);
  ints.set(pageIds, head);
  return ints.buffer;
}

/** Le relevé tel que la carte le rend : l'entête et les pages, puis la liste compactée. */
function withDrawn(header: number[], pageIds: number[], drawn: number[], pageCount: number) {
  const head = SELECTION_HEADER_WORDS,
    words = head + pageCount;
  const ints = new Uint32Array(words * 2);
  ints.set(header, 0);
  ints.set(pageIds, head);
  ints[words] = drawn.length;
  ints.set(drawn, words + head);
  return { bytes: ints.buffer, drawnWordOffset: words };
}

/** Les deux relevés d'un même contenu, chacun dans la disposition de son lecteur. L'oracle ne reçoit
 *  que les quatre mots qu'il sait lire : les totaux ne lui sont pas soumis, il ne les connaît pas. */
const paire = (header: number[], pageIds: number[]) => ({
  neuf: buffer(header, pageIds),
  oracle: buffer(header.slice(0, HEAD_ORACLE), pageIds, HEAD_ORACLE),
});
const lire = (bytes: ArrayBuffer) => parseDagOutput(bytes, 0, bytes.byteLength, 0);
const lireOracle = (bytes: ArrayBuffer) => referenceParseDagOutput(bytes, 0, bytes.byteLength, 0);

// Le bit 0 du mot 3 a changé de sens avec le plafond du relevé (`gpuDagLayout.ts`). Il disait « la
// coupe a écrit plus de rangs qu'il n'existe de grappes », c'est-à-dire une panne, et l'oracle
// rendait `null` : la sélection GPU était abandonnée pour la session. Il dit maintenant « la coupe
// ne tenait pas sous le plafond », situation normale d'une scène extrême — les noyaux ont tourné, le
// masque de l'image est juste, seule la LISTE est amputée. Le relevé est rendu, et marqué.
test('le bit 0 du mot 3 déclare le relevé tronqué, sans le jeter', () => {
  const { neuf, oracle } = paire([5, 0, 0, 1], [1, 2, 3, 4, 5]);
  const releve = lire(neuf);
  assert.ok(releve, 'un relevé tronqué reste un relevé');
  assert.equal(releve.truncated, true);
  assert.deepEqual(releve.pageIds, [1, 2, 3, 4, 5]);
  assert.equal(lireOracle(oracle), null, 'ce que faisait l’oracle');
});

test('un relevé qui tient sous le plafond n’est jamais déclaré tronqué', () => {
  const { neuf } = paire([3, 0, 0, 0], [10, 20, 30]);
  assert.equal(lire(neuf)!.truncated, false);
});

test('le relevé est rendu classé : la demande la plus coûteuse d’abord', () => {
  // Chaque rang est un mot de demande, page et priorité mêlées (`gpuDagRequest.ts`). La carte les
  // écrit dans l'ordre d'un compteur atomique, donc dans aucun ; c'est la relecture qui classe.
  const demandes = [
    packRequest(70, 12),
    packRequest(11, 900),
    packRequest(42, 300),
    packRequest(5, 900),
    packRequest(9, 0),
  ];
  const { neuf } = paire([demandes.length, 0, 0, 0], demandes);
  const releve = lire(neuf)!;
  // Priorité décroissante ; à priorité égale, l'ordre d'émission est conservé — il est indifférent,
  // comme il l'est sur le chemin WebGL2, qui ne départage pas non plus deux erreurs égales.
  assert.deepEqual(releve.pageIds, [11, 5, 42, 70, 9]);
});

test('le classement reste stable sur un relevé massif où presque tout est à égalité', () => {
  // Le classement est un TRI PAR COMPTAGE sur les mille vingt-quatre pas de priorité. Un tri par
  // seaux se casse là où un tri par comparaison ne bronche pas : aux deux bouts de la plage, et
  // quand presque tous les rangs tombent dans le même seau. Ce relevé pousse les deux à la fois.
  const PAS = [0, 1, REQUEST_PRIORITY_MAX - 1, REQUEST_PRIORITY_MAX];
  const demandes: number[] = [];
  for (let i = 0; i < 4000; i++) demandes.push(packRequest(i, PAS[i % PAS.length]));
  const { neuf } = paire([demandes.length, 0, 0, 0], demandes);
  const pageIds = lire(neuf)!.pageIds;
  assert.equal(pageIds.length, demandes.length);
  // Priorité décroissante d'un bout à l'autre, et À PRIORITÉ ÉGALE l'ordre d'émission intact : les
  // pages d'un même pas sortent croissantes, puisque c'est dans cet ordre qu'elles ont été émises.
  let precedente = REQUEST_PRIORITY_MAX + 1,
    dernierePage = -1;
  for (const page of pageIds) {
    const priorite = PAS[page % PAS.length];
    assert.ok(priorite <= precedente, `page ${page} : priorité ${priorite} après ${precedente}`);
    // La comparaison ne porte QUE sur deux pages du même pas ; au changement de pas elle ne se fait
    // pas, et `dernierePage` recommence de la page suivante.
    if (priorite === precedente)
      assert.ok(page > dernierePage, `page ${page} après ${dernierePage}`);
    precedente = priorite;
    dernierePage = page;
  }
});

test('les totaux de triangles sont relus tels que la carte les a posés', () => {
  const { neuf } = paire([3, 0, 0, 0, 900, 90, 700, 200], [10, 20, 30]);
  const releve = lire(neuf)!;
  assert.equal(releve.selectedTriangles, 900);
  assert.equal(releve.transparentTriangles, 90);
  assert.equal(releve.drawnTriangles, 700);
  assert.equal(releve.uncoveredTriangles, 200);
  // L'invariant que le processeur documentait, tenu désormais par la carte.
  assert.equal(releve.selectedTriangles! - releve.drawnTriangles! - releve.uncoveredTriangles!, 0);
});

test('a normal readback without a mask matches the reference field for field', () => {
  const { neuf, oracle } = paire([3, 42, 2, 0], [10, 20, 30]);
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)));
  assert.deepEqual(champs(lire(neuf)), {
    pageIds: [10, 20, 30],
    frustumRejected: 42,
    lodLevel: 2,
    complete: true,
    drawablePageIds: undefined,
  });
});

test('the incomplete flag (bit 1 of word 3) is reported the same way by both sides', () => {
  const { neuf, oracle } = paire([1, 0, 0, 2], [7]);
  assert.equal(lire(neuf)!.complete, false);
  assert.equal(lireOracle(oracle).complete, false);
});

test('a page count larger than the buffer holds is clamped identically, with and without a mask', () => {
  const { neuf, oracle } = paire([1000, 0, 0, 0], [1, 2, 3]);
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)));
  assert.equal(lire(neuf)!.pageIds.length, 3);
});

test('la liste dessinable compactée est relue telle quelle, sans parcourir toutes les pages', () => {
  const { bytes, drawnWordOffset } = withDrawn([2, 0, 0, 0], [5, 6], [0, 2, 3, 6], 8);
  const releve = parseDagOutput(bytes, 0, bytes.byteLength, drawnWordOffset);
  assert.deepEqual(releve!.pageIds, [5, 6]);
  assert.deepEqual(releve!.drawablePageIds, [0, 2, 3, 6]);
});

test('un compte dessinable plus grand que le relevé est ramené à ce qu il contient', () => {
  const { bytes, drawnWordOffset } = withDrawn([1, 0, 0, 0], [5], [1, 2], 4);
  new Uint32Array(bytes)[drawnWordOffset] = 1000;
  const releve = parseDagOutput(bytes, 0, bytes.byteLength, drawnWordOffset);
  assert.equal(releve!.drawablePageIds!.length, 4);
});

test('an empty buffer (all zero) and a zero-length byte range never crash', () => {
  const vide = new ArrayBuffer(SELECTION_HEADER_WORDS * 4);
  assert.deepEqual(champs(lire(vide)), champs(lireOracle(new ArrayBuffer(HEAD_ORACLE * 4))));
  const rien = new ArrayBuffer(0);
  assert.deepEqual(champs(lire(rien)), champs(lireOracle(rien)));
});
