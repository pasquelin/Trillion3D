// With no light anywhere, a view must not come out black on WebGL2. The scene declares none, the
// contract none either: WebGPU draws the `auto` view's default, the unlit albedo
// (`SceneLightStore.unlit`), and WebGL2 draws the same unlit view rather than leaving the source
// graph lighting with nothing in it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { harness, light } from './contractLights.fixture.ts'

test('with no light in the scene nor the contract, WebGL2 draws the unlit view, not black', () => {
  const bench = harness()
  const drawn = () => bench.visibleLights().map((lamp) => `${lamp.kind} ${lamp.intensity}`)
  assert.equal(bench.store.unlit, true, 'WebGPU reads this store as its unlit view')
  assert.deepEqual(drawn(), [`ambient ${Math.PI}`], 'an irradiance of π yields albedo')
  assert.equal(bench.contract.lit, false, 'composed by identity, as an unlit view')

  // A light the source graph gains, copied again (`refreshSceneLighting`), takes the view back: it
  // lights alone.
  bench.source.add(light('directional', 2))
  bench.lighting.refresh()
  assert.deepEqual(drawn(), ['directional 2'])
  assert.equal(bench.contract.lit, true)

  // Its last light gone, the unlit view comes back on the same, unchanged store.
  bench.source.clear()
  bench.lighting.refresh()
  assert.deepEqual(drawn(), [`ambient ${Math.PI}`])
})
