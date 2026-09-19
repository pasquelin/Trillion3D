// "honest measurement harness counters" batch: `resume()` gains three columns (submitted
// triangles, held image, GPU selection fallback) and never writes 0 for an absent measurement — only a
// dash does, as for columns already in place (`num`, `mo`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resume } from './rapport.mjs';

/** A minimal report: one series, one side, just what `resume()` reads. */
function rapport(side) {
  return {
    engine: 'moteur-test',
    scene: 'scene-test',
    commande: 'pnpm run mesure',
    head: 'abc123',
    sides: { a: { from: 'develop' } },
    settings: { frames: 8, warmup: 2, width: 640, height: 360, maxPages: 32 },
    startedAt: 't0',
    finishedAt: 't1',
    errors: [],
    series: [
      {
        view: 'salon',
        pixelError: 1,
        temoinAA: null,
        ecartAvantApres: null,
        sides: { a: side },
      },
    ],
  };
}

const baseSide = {
  moteur: null,
  cpuFrameMs: null,
  cpuSelectMs: null,
  gpuFrameMs: null,
  profilParEtape: null,
  selectedTriangles: null,
  uncoveredTriangles: null,
  drawnTriangles: null,
  submittedTriangles: null,
  totalSubmittedTriangles: null,
  imageTenue: null,
  repliSelectionGpu: null,
  hiZ: { tested: null, rejected: null, beyond16Texels: null, image: null },
  selection: { source: null, sha256: null, taille: 0 },
  budgetPages: { demande: 32, residentes: null },
  geometrieOctets: null,
  charge: { debut: null, fin: null },
};

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
      hiZ: { tested: 200, rejected: 40, beyond16Texels: 5, image: 42 },
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
      hiZ: { tested: null, rejected: null, beyond16Texels: null, image: null },
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

// Synchronous triangles batch: "coverage" column displays `selected − drawn − uncovered`,
// expected at zero, and a dash as soon as one of three counters is missing — never an inferred value.
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

test('resume() opens the computation path section, even when no side publishes it', () => {
  const texte = resume(rapport({ ...baseSide }));
  assert.match(texte, /## Batch compute path/);
  assert.match(texte, /\| reading missing from this dist \|/);
});
