import assert from 'node:assert/strict'

// What the temporal passes' runs in JavaScript need beyond `shaderRunBuiltins.fixture.ts`: the page
// record's terms a texel carries (`PAGE_OF_WGSL`), built by member name, and the comparison of a
// run's vectors to three decimals.
const TaaPage = (animated: number, responsive: number) => ({ animated, responsive })

export const taaBuiltins = { TaaPage }

export type Vec = number[]
/** Whether `actual` is `expected` to three decimals. */
export const close = (actual: Vec, expected: Vec) =>
  assert.deepEqual(
    actual.map((v) => +v.toFixed(3) || 0),
    expected,
  )
