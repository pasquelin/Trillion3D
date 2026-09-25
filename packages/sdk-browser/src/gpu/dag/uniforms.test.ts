// A11: parseDagOutput sizes its arrays ahead of time instead of a typed-array spread and a
// `push` with no capacity. Oracle: the version from before batch A, in `../../../../../bench/oracles/browser/residency.ts`.
//
// THE HEADER HAS CHANGED WIDTH since then: four words at first — a count, frustum reject, the
// level, the flags — eight now, the next four carrying the triangle totals the GPU holds
// (`layout.ts`). The oracle is frozen at four. Each side therefore receives a readback IN
// ITS OWN LAYOUT, with the same values, and the comparison is on what they extract: it is the
// decode that is compared, not the placement of the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDagOutput } from './uniforms.ts';
import { SELECTION_HEADER_WORDS } from './layout.ts';
import { REQUEST_PRIORITY_MAX, packRequest } from './request.ts';
import { referenceParseDagOutput } from '../../../../../bench/oracles/browser/residency.ts';
import type { SelectionResult } from '../core/selection.ts';

/** The oracle's header: four words, those from before the totals. */
const HEAD_ORACLE = 4;

/**
 * The readback reduced to what both sides can carry. `drawablePageIds` is normalised — the oracle
 * only wrote the key when a mask existed, the reused readback always carries it. Fields that only
 * one of the two produces — `truncated`, `requestPriorities` that only the oracle publishes,
 * `complete` that only the oracle still reads (the cut rule leaves no surface undrawn, #486), and
 * the four totals — are STRIPPED and asserted separately: comparing them would ask a side for
 * something it never knew.
 */
const champs = (releve: (Partial<SelectionResult> & { complete?: boolean }) | null) => {
  if (!releve) return releve;
  const {
    truncated: _t,
    complete: _c,
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

/** The readback as the GPU returns it: the header and the pages, then the compacted list. */
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

/** Both readbacks of the same content, each in its reader's layout. The oracle only receives the
 *  four words it knows how to read: the totals are not submitted to it, it does not know them. */
const paire = (header: number[], pageIds: number[]) => ({
  neuf: buffer(header, pageIds),
  oracle: buffer(header.slice(0, HEAD_ORACLE), pageIds, HEAD_ORACLE),
});
const lire = (bytes: ArrayBuffer) => parseDagOutput(bytes, 0, bytes.byteLength, 0);
const lireOracle = (bytes: ArrayBuffer) => referenceParseDagOutput(bytes, 0, bytes.byteLength, 0);

// Bit 0 of word 3 changed meaning with the readback cap (`layout.ts`). It used to say "the
// cut wrote more ranks than there are clusters", i.e. a failure, and the oracle returned `null`:
// GPU selection was abandoned for the session. It now says "the cut did not fit under the cap", a
// normal situation for an extreme scene — the kernels ran, the frame mask is correct, only the
// LIST is truncated. The readback is returned, and marked.
test('bit 0 of word 3 declares the readback truncated, without discarding it', () => {
  const { neuf, oracle } = paire([5, 0, 0, 1], [1, 2, 3, 4, 5]);
  const releve = lire(neuf);
  assert.ok(releve, 'a truncated readback is still a readback');
  assert.equal(releve.truncated, true);
  assert.deepEqual(releve.pageIds, [1, 2, 3, 4, 5]);
  assert.equal(lireOracle(oracle), null, 'what the oracle used to do');
});

test('a readback that fits under the cap is never declared truncated', () => {
  const { neuf } = paire([3, 0, 0, 0], [10, 20, 30]);
  assert.equal(lire(neuf)!.truncated, false);
});

test('the readback is returned sorted: the costliest request first', () => {
  // Each rank is a request word, page and priority mixed (`request.ts`). The GPU writes them
  // in the order of an atomic counter, hence in none; it is the reread that sorts.
  const demandes = [
    packRequest(70, 12),
    packRequest(11, 900),
    packRequest(42, 300),
    packRequest(5, 900),
    packRequest(9, 0),
  ];
  const { neuf } = paire([demandes.length, 0, 0, 0], demandes);
  const releve = lire(neuf)!;
  // Decreasing priority; at equal priority, emission order is kept — it is indifferent, as it is
  // on the WebGL2 path, which does not break ties between two equal errors either.
  assert.deepEqual(releve.pageIds, [11, 5, 42, 70, 9]);
});

test('the sort stays stable on a massive readback where almost everything is tied', () => {
  // The sort is a COUNTING SORT over the one thousand and twenty-four priority steps. A bucket
  // sort breaks where a comparison sort does not: at both ends of the range, and when almost every
  // rank falls in the same bucket. This readback pushes both at once.
  const PAS = [0, 1, REQUEST_PRIORITY_MAX - 1, REQUEST_PRIORITY_MAX];
  const demandes: number[] = [];
  for (let i = 0; i < 4000; i++) demandes.push(packRequest(i, PAS[i % PAS.length]));
  const { neuf } = paire([demandes.length, 0, 0, 0], demandes);
  const pageIds = lire(neuf)!.pageIds;
  assert.equal(pageIds.length, demandes.length);
  // Decreasing priority from end to end, and AT EQUAL PRIORITY the emission order intact: pages of
  // the same step come out increasing, since that is the order they were emitted in.
  let precedente = REQUEST_PRIORITY_MAX + 1,
    dernierePage = -1;
  for (const page of pageIds) {
    const priority = PAS[page % PAS.length];
    assert.ok(priority <= precedente, `page ${page}: priority ${priority} after ${precedente}`);
    // The comparison is ONLY between two pages of the same step; at a step change it is not done,
    // and `dernierePage` restarts from the next page.
    if (priority === precedente)
      assert.ok(page > dernierePage, `page ${page} after ${dernierePage}`);
    precedente = priority;
    dernierePage = page;
  }
});

test('triangle totals are reread as the GPU posted them', () => {
  const { neuf } = paire([3, 0, 0, 0, 900, 90, 700, 200], [10, 20, 30]);
  const releve = lire(neuf)!;
  assert.equal(releve.selectedTriangles, 900);
  assert.equal(releve.transparentTriangles, 90);
  assert.equal(releve.drawnTriangles, 700);
  assert.equal(releve.uncoveredTriangles, 200);
  // The invariant the CPU documented, now held by the GPU.
  assert.equal(releve.selectedTriangles - releve.drawnTriangles - releve.uncoveredTriangles, 0);
});

test('a normal readback without a mask matches the reference field for field', () => {
  const { neuf, oracle } = paire([3, 42, 2, 0], [10, 20, 30]);
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)));
  assert.deepEqual(champs(lire(neuf)), {
    pageIds: [10, 20, 30],
    frustumRejected: 42,
    lodLevel: 2,
    drawablePageIds: undefined,
  });
});

test('a page count larger than the buffer holds is clamped identically, with and without a mask', () => {
  const { neuf, oracle } = paire([1000, 0, 0, 0], [1, 2, 3]);
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)));
  assert.equal(lire(neuf)!.pageIds.length, 3);
});

test('the compacted drawable list is reread as-is, without walking every page', () => {
  const { bytes, drawnWordOffset } = withDrawn([2, 0, 0, 0], [5, 6], [0, 2, 3, 6], 8);
  const releve = parseDagOutput(bytes, 0, bytes.byteLength, drawnWordOffset);
  assert.deepEqual(releve!.pageIds, [5, 6]);
  assert.deepEqual(releve!.drawablePageIds, [0, 2, 3, 6]);
});

test('a drawable count larger than the readback holds is clamped to what it contains', () => {
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
