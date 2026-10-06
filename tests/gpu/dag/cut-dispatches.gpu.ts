// The single-pass cut opens fewer commands than the cut it replaced and keeps exactly its pages.
// The shipped cut runs for real (`createDagResources`, `encodeDagKernels`); the former one is the
// frozen oracle `bench/oracles/browser/cut-dispatches.ts`, whose descent alone differs and whose
// other stages are the shipped ones. Both keep and draw the same pages, bit for bit, and so does
// the shipped descent launched over wider tiers. The commands each opens, counted on the encoders,
// and the time each frame takes are published, never asserted (`cutDispatchesPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { DISPATCH_SCENE } from './cutScene.ts'

test('the cut opens fewer commands and keeps exactly the same pages', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'cutDispatchesPage.ts'),
    'cutDispatches',
  )) as typeof import('./cutDispatchesPage.ts')
  const pageErrors: string[] = []
  const reading = await runOnDawn(
    page.measureDispatches,
    // The scene's depth, then two lengthened ones: their extra tiers are empty, so they measure
    // the commands' slope, not a deep scene.
    {
      ...DISPATCH_SCENE,
      depths: [13, 21],
      frames: 200,
      rounds: 5,
      bounds: [0, 1000, 100000, 1000000],
    },
    pageErrors,
  )
  const { outputs, bounds, rows, ...scene } = reading
  console.log(
    JSON.stringify(
      {
        ...scene,
        kept: outputs[0].pages.length,
        drawn: outputs[0].drawn.length,
        rows,
        bounds: bounds.map(({ width, ms }) => ({ width, ms })),
      },
      null,
      2,
    ),
  )
  assert.deepEqual([...reading.errors, ...pageErrors], [])
  const [before, after] = outputs
  assert.ok(before.pages.length > 0, 'the cut must keep pages')
  assert.deepEqual(after.pages, before.pages, 'the same wanted pages, bit for bit')
  assert.deepEqual(after.drawn, before.drawn, 'the same drawn pages, bit for bit')
  assert.equal(after.overflow, before.overflow)
  assert.equal(after.frustumRejected, before.frustumRejected)
  // A wider tier changes no verdict: the extra threads exit on the count guard.
  for (const { width, output } of bounds)
    assert.deepEqual(output.pages, after.pages, `tiers ${width} wide: the cut changed`)
})
