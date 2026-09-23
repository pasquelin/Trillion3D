// Synchronous triangles batch: "coverage" column displays `selected − drawn − uncovered`,
// expected at zero, and a dash as soon as one of three counters is missing — never an inferred
// value. Split from `rapport.test.ts` to keep both files under the line budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resume } from './rapport.ts';
import { baseSide, rapport } from './rapportTestFixtures.ts';

test('coverage column displays selected − drawn − uncovered, and drawnTriangles next to it', () => {
  const texte = resume(
    rapport({
      ...baseSide,
      selectedTriangles: 900,
      drawnTriangles: 800,
      uncoveredTriangles: 100,
    }),
  );
  assert.match(texte, /\| drawnTriangles \| coverage \|/, 'the two headers in that order');
  assert.match(texte, /\| 900 \| 800 \| 0 \|/, 'selected, drawn, then computed coverage');
});

test('coverage is a dash as soon as a single counter of the three is missing', () => {
  const sansSelected = resume(
    rapport({
      ...baseSide,
      selectedTriangles: null,
      drawnTriangles: 800,
      uncoveredTriangles: 100,
    }),
  );
  const sansDrawn = resume(
    rapport({
      ...baseSide,
      selectedTriangles: 900,
      drawnTriangles: null,
      uncoveredTriangles: 100,
    }),
  );
  const sansUncovered = resume(
    rapport({
      ...baseSide,
      selectedTriangles: 900,
      drawnTriangles: 800,
      uncoveredTriangles: null,
    }),
  );
  // All three cells (selected, drawn, coverage) together: dash for coverage, never
  // a subtraction where a `null` operand was treated as zero.
  assert.match(sansSelected, /\| — \| 800 \| — \|/);
  assert.match(sansDrawn, /\| 900 \| — \| — \|/);
  assert.match(sansUncovered, /\| 900 \| 800 \| — \|/);
});

test('a non-zero coverage is displayed as is, without being reduced to a dash', () => {
  const texte = resume(
    rapport({
      ...baseSide,
      selectedTriangles: 900,
      drawnTriangles: 750,
      uncoveredTriangles: 100,
    }),
  );
  assert.match(texte, /\| 50 \|/, 'selected − drawn − uncovered = 50, a real hole in the relation');
});
