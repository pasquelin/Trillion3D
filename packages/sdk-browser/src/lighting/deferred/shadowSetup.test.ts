// The passes that light a surface read what a shadow read needs once a pixel: the sun's pass and the local
// lights' set the mask's pixel (`vsmMaskAt`) before their lights, the local lights' pass reads its cell of the
// light grid once and walks that list; the sun's reads no cell, it walks the directional lights by their
// ranks. The program with no shadow code never reads a shadow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import {
  createSceneLightContractBuffer,
  createSunRanksBuffer,
  uploadSceneLights,
} from '../../frame/backend/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../frame/backend/state/lights.ts'

/** The text of the entry point `entry` of `shader`, to the next entry point or its end. */
const entryOf = (shader: string, entry: string) => {
  const from = shader.indexOf(`fn ${entry}(`)
  const next = shader.indexOf('@fragment', from)
  return shader.slice(from, next < 0 ? undefined : next)
}

test('the passes set the mask’s pixel once, the local lights’ reads its cell once', () => {
  for (const [bounce, narrow, shadowed] of [
    [false, false, true],
    [true, true, true],
    [false, false, false],
  ] as const) {
    const { sun, local } = litPassShaders(bounce, { narrow, unshadowed: !shadowed, lobeless: true })
    const sunMain = entryOf(sun, 'sunMain'),
      localMain = entryOf(local, 'localMain')
    assert.equal(sunMain.match(/vsmMaskAt\(coord\);/g)?.length, 1, 'the mask’s pixel, once')
    assert.equal(
      localMain.match(/vsmMaskAt\(coord,record\);/g)?.length,
      1,
      'the mask’s pixel and its cell, once',
    )
    assert.equal(localMain.match(/pixelCell\(/g)?.length, 1, 'the cell, read once')
    assert.match(localMain, /let record=pixelCell\(pixel\.xy,z\);\s*let cell=cellSlice\(record\);/)
    assert.match(localMain, /localLighting\([^;]*,cell\)/)
    assert.doesNotMatch(sunMain, /pixelCell|cellSlice/, 'the sun’s pass reads no cell')
    for (const shader of [sun, local]) {
      assert.doesNotMatch(shader, /shadowReceiver\(/)
      assert.doesNotMatch(shader, /pixelFootprint|shadowFootprint|shadowAngularPixel/)
    }
    // The loops find no cell again: the list is walked, not searched.
    assert.doesNotMatch(functionsOf(local, ['localLighting']), /gridCell|pixelCell|TILE_SHADOWED/)
    assert.doesNotMatch(functionsOf(sun, ['sunLighting']), /gridCell|pixelCell|TILE_SHADOWED/)
  }
})

test('the sun’s pass walks the directional lights by their ranks, the local lights’ leaves them to it', () => {
  const { sun, local } = litPassShaders(false)
  assert.match(functionsOf(sun, ['sunLighting']), /sunRanks\[0\]/)
  assert.match(functionsOf(sun, ['sunLighting']), /declaredLight\(sunRanks\[index\]/)
  assert.match(
    functionsOf(local, ['localLighting']),
    /if\(isSunKind\(directLights\.items\[rank\]\.params\.x\)\)\{continue;\}/,
  )
})

test('the sun pass walks the directional lights by their ranks: the buffer holds their count, then their slots', () => {
  const gpu = fakeDevice()
  const store = createSceneLightStore()
  const light = (id: string, kind: 'point' | 'directional'): SceneLight =>
    kind === 'point'
      ? {
          id,
          kind,
          position: [0, 1, 0],
          color: [1, 1, 1],
          intensity: 1,
          range: 5,
          castsShadow: false,
        }
      : { id, kind, direction: [0, -1, 0], color: [1, 1, 1], intensity: 1, castsShadow: false }
  store.add(light('lamp', 'point'))
  store.add(light('sun', 'directional'))
  store.add(light('lamp2', 'point'))
  store.add(light('moon', 'directional'))
  const lights = createWebgpuLightState(store)
  lights.buffer = createSceneLightContractBuffer(gpu.device, store)
  lights.sunRanks = createSunRanksBuffer(gpu.device, store)
  uploadSceneLights(gpu.device, lights)
  const ranks = gpu.writes.filter(({ buffer }) => buffer === lights.sunRanks)
  assert.equal(ranks.length, 1)
  assert.deepEqual([...written(ranks[0])], [2, 1, 3])
  // A light removed publishes the epoch again: the ranks follow it.
  store.remove('sun')
  uploadSceneLights(gpu.device, lights)
  const after = gpu.writes.filter(({ buffer }) => buffer === lights.sunRanks).at(-1)!
  assert.equal(written(after)[0], 1, 'one sun left')
})
