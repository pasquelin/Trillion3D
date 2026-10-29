// The visibility raster is executed as render bundles; the shadow
// raster's chunk passes encode their four commands directly (a pass each, nothing to bundle). On the
// generated facade the sun cuts sharp shadows into (`facade-7`), the settled street view drawn with
// the bundles equals, pixel for pixel, the same view of a fresh world whose bundles are encoded as
// their commands in the pass (`withDirectBundles`): image class 1, the shadow pages included. Two
// fresh worlds with bundles prove the view stable (A/A, 0 px) before the comparison means anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'

test(
  'the bundled passes over a casting sun draw the image their commands draw',
  { timeout: 300_000 },
  async () => {
    const errors: string[] = []
    const page = (await loadPage(
      resolve(import.meta.dirname, 'renderBundlesPage.ts'),
      'renderBundles',
    )) as typeof import('./renderBundlesPage.ts')
    const reading = await runOnDawn(page.run, null, errors)
    console.log(JSON.stringify(reading))
    assert.deepEqual(errors, [])
    assert.deepEqual(reading.held, [true, true, true], 'every world settles its view')
    assert.ok(reading.executed > 0, 'the frames executed bundles')
    assert.ok(!reading.labels.includes('vsm.render.raster'), 'the shadow raster is direct')
    assert.equal(reading.stable, 0, 'two fresh worlds draw the same view (A/A)')
    assert.equal(reading.gap, 0, `the bundles change ${reading.gap} pixels of ${reading.pixels}`)
  },
)
