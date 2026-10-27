// The ids of a frame's maps (`mapIds.ts`): two ranges as the reference lays them — the maps of one page
// (a distant light's) from id 0, then the full maps, the suns' first — so that a distant light keeps
// its id whatever the full maps do; the prefiltered history addresses the suns from their first map.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { perspectiveProjection } from '../../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { createVsmFrameState } from './frameState.ts'
import {
  commitVirtualShadowFrame,
  finishVirtualShadowFrame,
  markVirtualShadowRendered,
  planVirtualShadowFrame,
} from './frameSetup.ts'
import { VsmMapIds } from './mapIds.ts'
import { VsmLightCache } from './lightCache.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { VSM_RECORD_MAP_COUNT } from './constants.ts'

/** An entry of `maps` maps, distant or not (`VsmLightCache.updateLocal`). */
const entryOf = (id: string, maps: number, distant = false) => {
  const entry = new VsmLightCache(id, maps)
  entry.updateLocal(false, distant, false, false)
  return entry
}

test('the maps of one page take the first ids, then the suns, then the full maps, a light before the entries no light referenced', () => {
  const ids = new VsmMapIds().reset()
  // Claimed in any order: the runs lie in their own.
  const fullUnreferenced = entryOf('full unreferenced', 6)
  const near = entryOf('near', 6)
  const sun = entryOf('sun', 17)
  const singleUnreferenced = entryOf('single unreferenced', 1, true)
  const far = entryOf('far', 6, true)
  ids.claim(fullUnreferenced, 'unreferenced')
  ids.claim(near, 'light')
  ids.claim(sun, 'sun')
  ids.claim(singleUnreferenced, 'unreferenced')
  ids.claim(far, 'light')
  ids.seal()
  const at = [far, singleUnreferenced, sun, near, fullUnreferenced].map((e) => ids.firstIdOf(e))
  assert.deepEqual(at, [0, 6, 7, 24, 30])
  assert.equal(ids.mapCount, 36)
  assert.equal(ids.sunBase, 7, 'the suns lie from the end of the single-page range')
  // The same lights again, with another number of full maps: the single-page maps keep their ids.
  ids.reset()
  ids.claim(far, 'light')
  ids.claim(entryOf('other', 12), 'light')
  ids.claim(entryOf('sun', 17), 'sun')
  ids.seal()
  assert.equal(ids.firstIdOf(far), 0)
})

test('nothing moves until the claims are committed, and the ids more than a record names are refused', () => {
  const cache = new VsmCacheManager()
  const lamp = cache.lightEntryFor('lamp', 6)
  lamp.moveToMapId(4)
  const ids = new VsmMapIds().reset()
  ids.claim(lamp, 'light')
  ids.seal()
  assert.deepEqual([lamp.mapId, lamp.prevMapId], [4, -1], 'claimed, not moved')
  assert.equal(ids.nextMapCount, 10, 'the next-map data under its previous ids is known at once')
  cache.commitIds(ids)
  assert.deepEqual([lamp.mapId, lamp.prevMapId], [0, 4])
  ids.reset()
  assert.equal(ids.exhausted, false)
  ids.claim(entryOf('whole', VSM_RECORD_MAP_COUNT), 'light')
  assert.equal(ids.exhausted, false)
  ids.claim(entryOf('one more', 1), 'light')
  assert.equal(ids.exhausted, true)
  ids.reset()
  assert.equal(ids.exhausted, false, 'a new frame starts over')
})

// The plan gives a distant light's maps the first ids, the suns the run after them, the other lights'
// the rest; the same lights asked again keep their ids, and a full-map light that comes does not move a
// distant one.
test('a plan lays the ids by range: the distant lights, the sun, then the lights in view', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const state = createVsmFrameState(device, res)
  const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const camera = {
    ...{ view, eye: [0, 0, 0], perspective: true },
    projection: perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1),
  }
  const base = { color: [1, 1, 1] as [number, number, number], intensity: 1, castsShadow: true }
  const sun: SceneLight = { ...base, id: 'sun', kind: 'directional', direction: [0, -1, 0] }
  const lamp = (id: string, z: number, range: number): SceneLight => ({
    ...{ ...base, id, kind: 'point', range },
    position: [0, 3, z],
  })
  const far = lamp('far', -6000, 1)
  const plan = (lights: SceneLight[]) => {
    const frame = planVirtualShadowFrame(
      state,
      lights.map((light) => ({ light })),
      camera,
      { width: 1000, height: 1000 },
    )
    commitVirtualShadowFrame(state, frame)
    markVirtualShadowRendered(frame, frame.lights)
    finishVirtualShadowFrame(state, frame)
    return new Map(frame.lights.map((l) => [l.id, l]))
  }
  const first = plan([lamp('near', -10, 5), far, sun])
  assert.equal(first.get('far')!.entry.distant, true, 'a small lamp far away is distant')
  assert.equal(first.get('near')!.entry.distant, false)
  // A point light's maps are its cube's six faces, a distant one's six pages.
  const [run, suns] = [first.get('far')!.count, first.get('sun')!.count]
  assert.equal(run, 6)
  assert.deepEqual(
    ['far', 'sun', 'near'].map((id) => first.get(id)!.firstId),
    [0, run, run + suns],
    'the distant lamp’s run, then the sun, then the full maps',
  )
  // Another lamp in view: the distant lamp keeps its id.
  const second = plan([lamp('near', -10, 5), lamp('other', -12, 5), far, sun])
  assert.equal(second.get('far')!.firstId, 0)
})
