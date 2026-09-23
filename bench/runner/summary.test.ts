// "honest measurement harness counters" batch: `resume()` gains three columns (submitted
// triangles, held image, GPU selection fallback) and never writes 0 for an absent measurement — only a
// dash does, as for columns already in place (`num`, `mo`).
// Coverage-column tests live in `summaryCoverage.test.ts`, to keep both files under the line budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resume } from './summary.ts';
import { baseSide, rapport } from './summaryTestFixtures.ts';

test('resume() publishes the three new columns, each under its own header', () => {
  const texte = resume(rapport({ ...baseSide }));
  assert.match(texte, /\| submitted triangles opaque\/total \| held image \|/);
  assert.match(texte, /\| GPU selection fallback \|/);
  assert.match(texte, /\| Hi-Z tested\/rejected\/>16 \(image\) \|/);
});

test('measured counters are displayed as is, never reduced to a dash', () => {
  const texte = resume(
    rapport({
      ...baseSide,
      submittedTriangles: 1500,
      totalSubmittedTriangles: 1800,
      imageTenue: true,
      repliSelectionGpu: false,
      hiZ: {
        tested: 200,
        rejected: 40,
        beyond16Texels: 5,
        testedTriangles: null,
        rejectedTriangles: null,
        beyond16TexelsTriangles: null,
        image: 42,
      },
    }),
  );
  assert.match(texte, /\| 1500\/1800 \| yes \|/, 'submitted triangles, opaque then total');
  assert.match(texte, /\| no \|/, 'GPU selection fallback at false');
  assert.match(
    texte,
    /\| 200\/40\/5 \(42\) \|/,
    'Hi-Z tested/rejected/>16, then the counted image',
  );
});

test('an absent counter is a dash, never a zero: `imageTenue`, `repliSelectionGpu`, submitted triangles, Hi-Z', () => {
  const texte = resume(
    rapport({
      ...baseSide,
      submittedTriangles: null,
      totalSubmittedTriangles: null,
      imageTenue: null,
      repliSelectionGpu: null,
      hiZ: {
        tested: null,
        rejected: null,
        beyond16Texels: null,
        testedTriangles: null,
        rejectedTriangles: null,
        beyond16TexelsTriangles: null,
        image: null,
      },
    }),
  );
  assert.match(
    texte,
    /\| —\/— \| — \|/,
    'no submitted triangles counted: two dashes, not two zeros',
  );
  assert.match(
    texte,
    /\| — \| —\/—\/— \(—\) \|/,
    'neither GPU fallback nor Hi-Z are an inferred zero',
  );
  assert.doesNotMatch(texte, /\| 0\/0 \| no \|/, 'a `null` is never read as `0` or `no`');
});

test('imageTenue set to true is distinguished from imageTenue set to false, not just from absence', () => {
  const held = resume(rapport({ ...baseSide, imageTenue: true }));
  const released = resume(rapport({ ...baseSide, imageTenue: false }));
  assert.match(held, /\| yes \|/);
  assert.match(released, /\| no \|/);
  assert.notEqual(held, released);
});

test('resume() opens the computation path section, even when no side publishes it', () => {
  const texte = resume(rapport({ ...baseSide }));
  assert.match(texte, /## Batch compute path/);
  assert.match(texte, /\| reading missing from this dist \|/);
});
