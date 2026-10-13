// The bounce's world light lists change no texel of the bounce cache: at points over the last
// cascade level's lattice — inside, on its cells' faces and past it —, the one irradiance the
// cache and the probe hits sum (`lightsIrradiance`) walking each point's cell list
// (`bounceLightSlice`) is the irradiance walking every light, bit for bit, for 1, 32 and 256
// lights — lamps and spots of every range, a rectangle, a sun —, the lists made by the light grid
// pass over the lattice (`createGpuLightTiles`, `world`). Each sum's dispatch is timed.
//
//   node bench/dawn/proofs.ts tests/gpu/bounce/light-lists.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runOnDawn, loadPage } from '../kit/onDawn.ts'

test('a bounce point walking its cell list sums what walking every light sums, bit for bit', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'lightListsPage.ts'),
    'bounceLightLists',
  )) as typeof import('./lightListsPage.ts')
  const pageErrors: string[] = []
  const result = await runOnDawn(page.run, [1, 32, 256], pageErrors)
  assert.ok(!('unavailable' in result), 'WebGPU must be available')
  assert.deepEqual([...result.errors, ...pageErrors], [])
  for (const { count, all, listed, lit, listWallMs } of result.runs) {
    console.log(JSON.stringify({ count, allMs: all.ms, listedMs: listed.ms, listWallMs, lit }))
    assert.ok(lit > 0, `${count} lights light some points`)
    let apart = 0
    for (let i = 0; i < all.words.length; i++) if (all.words[i] !== listed.words[i]) apart++
    assert.equal(apart, 0, `${count} lights: ${apart} words differ`)
  }
})
