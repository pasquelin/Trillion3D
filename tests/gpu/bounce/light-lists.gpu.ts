// The bounce's world light lists change no texel of the bounce cache: at points over the last
// cascade level's lattice — inside, on its cells' faces and past it —, the one irradiance the
// cache and the probe hits sum (`lightsIrradiance`) walking each point's cell list
// (`bounceLightSlice`) is the irradiance walking every light, bit for bit, for 1, 32 and 256
// lights — lamps and spots of every range, a rectangle, a sun — and 4096 small lamps,
// the lists made by the light grid's world pass over the lattice (`createGpuLightTiles`): the same
// loop with the cascades' uniform naming the lists or none. Each walk and the rebuild are timed.
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
  // 1, 32 and 256 lights reaching up to 20 m over the 32 m lattice; then 4096 small lamps.
  const sets = [
    ...[1, 32, 256].map((count) => ({ count, reach: 20 })),
    { count: 4096, reach: 3 },
  ].map((set) => ({ ...set, coherent: false }))
  const result = await runOnDawn(page.run, sets, pageErrors)
  assert.ok(!('unavailable' in result), 'WebGPU must be available')
  assert.deepEqual([...result.errors, ...pageErrors], [])
  const stats = (ms: number[]) => {
    const sorted = [...ms].sort((a, b) => a - b)
    return { median: sorted[sorted.length >> 1], min: sorted[0], max: sorted[sorted.length - 1] }
  }
  for (const { count, reach, coherent, fallbacks, all, listed, lit, ms } of result.runs) {
    const timing = { all: stats(ms.all), listed: stats(ms.listed), build: stats(ms.build) }
    console.log(JSON.stringify({ count, reach, coherent, fallbacks, lit, ...timing }))
    assert.ok(lit > 0, `${count} lights light some points`)
    let apart = 0
    for (let i = 0; i < all.length; i++) if (all[i] !== listed[i]) apart++
    assert.equal(apart, 0, `${count} lights: ${apart} words differ`)
  }
})
