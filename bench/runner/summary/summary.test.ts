// "honest measurement harness counters" batch: `resume()` gains three columns (submitted
// triangles, held image) and never writes 0 for an absent measurement — only a
// dash does, as for columns already in place (`num`, `mo`). Each check reads the cell under its
// header, never a pattern anywhere in the text.
// Coverage-column tests live in `summary/summaryCoverage.test.ts`, to keep both files under the line budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resume } from './summary.ts'
import { baseSide, rapport, tableRow } from './summaryTestFixtures.ts'

const SUBMITTED = 'submitted triangles opaque/total'
const HELD = 'held image'
const HIZ = 'Hi-Z tested/rejected/>16 (image)'
const readings = (side: Partial<typeof baseSide>) =>
  tableRow(resume(rapport({ ...baseSide, ...side })), 'Readings')

test('measured counters are displayed as is, each under its own header', () => {
  const row = readings({
    submittedTriangles: 1500,
    totalSubmittedTriangles: 1800,
    frameHeld: true,
    hiZ: {
      tested: 200,
      rejected: 40,
      beyond16Texels: 5,
      testedTriangles: null,
      rejectedTriangles: null,
      beyond16TexelsTriangles: null,
      image: 42,
    },
  })
  assert.equal(row[SUBMITTED], '1500/1800', 'submitted triangles, opaque then total')
  assert.equal(row[HELD], 'yes')
  assert.equal(row[HIZ], '200/40/5 (42)', 'Hi-Z tested/rejected/>16, then the counted image')
})

test('an absent counter is a dash, never a zero: `frameHeld`, submitted triangles, Hi-Z', () => {
  const row = readings({
    submittedTriangles: null,
    totalSubmittedTriangles: null,
    frameHeld: null,
  })
  assert.equal(row[SUBMITTED], '—/—', 'no submitted triangles counted: two dashes, not two zeros')
  assert.equal(row[HELD], '—')
  assert.equal(row[HIZ], '—/—/— (—)', 'nor Hi-Z an inferred zero')
})

test('frameHeld set to false is `no`, distinct from true and from absence', () => {
  assert.equal(readings({ frameHeld: false })[HELD], 'no')
  assert.equal(readings({ frameHeld: true })[HELD], 'yes')
})

test('resume() opens the computation path section, even when no side publishes it', () => {
  const row = tableRow(resume(rapport({ ...baseSide })), 'Batch compute path')
  assert.equal(row.module, 'reading missing from this dist')
})
