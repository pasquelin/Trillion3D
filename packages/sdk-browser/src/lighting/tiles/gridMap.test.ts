// The light grid's slice map: the farthest a local light reaches sets where the last slice starts, the
// slices before it spread as `log2(depth · B + O) · S`, a depth short of the first is in the first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { gridSlice, type Grid } from '../../../../../bench/oracles/browser/gpuLightGridOracle.ts'
import { writeGridMap } from './gridMap.ts'
import { lightGridFar } from './gridFar.ts'

const EYE = [0, 0, 0],
  FORWARD = [0, 0, -1],
  NEAR = 0.1
const lights = (...made: { kind?: 'point' | 'directional'; z: number; range?: number }[]) => {
  const store = createSceneLightStore()
  made.forEach(({ kind = 'point', z, range = 1 }, k) =>
    store.add({
      ...{ id: `l${k}`, kind, color: [1, 1, 1], intensity: 1, castsShadow: false },
      ...(kind === 'point' ? { position: [0, 0, -z], range } : { direction: [0, -1, 0] }),
    }),
  )
  return store
}
const far = (store: ReturnType<typeof lights>, near = NEAR) =>
  lightGridFar(store, EYE, FORWARD, near)

test('the grid reaches the farthest local light along the view axis, within its floor and its ceiling', () => {
  assert.equal(far(lights()), LIGHT_SETTINGS.gridFarFloor, 'no light: the floor')
  assert.equal(far(lights({ z: 30, range: 20 }, { z: 5, range: 100 })), 105)
  assert.equal(far(lights({ kind: 'directional', z: 0 })), LIGHT_SETTINGS.gridFarFloor)
  assert.equal(far(lights({ z: 1e7, range: 1 })), LIGHT_SETTINGS.gridFarMax)
  assert.equal(far(lights({ z: 1, range: 1 }), 20), 40, 'twice a near plane past the floor')
  assert.equal(far(lights({ z: -50, range: 20 })), LIGHT_SETTINGS.gridFarFloor, 'a light behind')
})

test('the last slice starts at the reach, the first holds what is before it', () => {
  const store = lights({ z: 80, range: 20 })
  const map = new Float32Array(4)
  writeGridMap(map, store, EYE, FORWARD, NEAR)
  const grid = { cell: 64, slices: LIGHT_SETTINGS.gridSlices, map: [map[0], map[1], map[2]] }
  const sliceAt = (depth: number) => gridSlice(NEAR / depth, grid as Grid)
  assert.equal(map[2], Math.fround(LIGHT_SETTINGS.gridDepthDistribution))
  assert.equal(sliceAt(NEAR), 0)
  assert.equal(sliceAt(NEAR + 0.09), 0)
  assert.equal(sliceAt(100.2), grid.slices - 1)
  assert.equal(sliceAt(99.9), grid.slices - 2)
  assert.equal(sliceAt(1e6), grid.slices - 1)
  let last = 0
  for (let depth = NEAR; depth < 100; depth *= 1.01) {
    const slice = sliceAt(depth)
    assert.ok(slice >= last && slice - last <= 1, `depth ${depth}`)
    last = slice
  }
})
