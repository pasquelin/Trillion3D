// The local fog volumes' API (`./localFogApi.ts`): each write goes through the store and asks the engine to
// read it again, what is handed out is a copy, a session without the store refuses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLocalFogStore } from '../../../sdk-core/src/scene/localFog/store.ts'
import { createExplorerLocalFogApi } from './localFogApi.ts'

test('the local fog volumes: added, changed, removed and listed through the store, the engine told each time, the list a copy', () => {
  const store = createSceneLocalFogStore()
  let refreshed = 0,
    checked = 0
  const api = createExplorerLocalFogApi({
    check: () => checked++,
    store,
    engine: { refreshFogVolumes: () => refreshed++ } as never,
  })
  api.addLocalFogVolume({ id: 'valley', heightDensity: 2 })
  api.setLocalFogVolume('valley', { albedo: [1, 0.5, 0.25] })
  assert.deepEqual([refreshed, checked], [2, 2])
  const [listed] = api.localFogVolumes()
  assert.deepEqual([listed.id, listed.heightDensity, listed.albedo], ['valley', 2, [1, 0.5, 0.25]])
  // Changing the copy changes nothing held.
  Reflect.set(listed.albedo, 0, 0)
  Reflect.set(listed.matrix, 12, 99)
  assert.deepEqual([store.get('valley')!.albedo[0], store.get('valley')!.matrix[12]], [1, 0])
  assert.throws(() => api.addLocalFogVolume({ id: 'valley' }), {
    code: 'DUPLICATE_SCENE_LOCAL_FOG_VOLUME',
  })
  api.removeLocalFogVolume('valley')
  assert.deepEqual([api.localFogVolumes().length, refreshed], [0, 3])
  // A session with no store refuses.
  const none = createExplorerLocalFogApi({ check: () => {}, store: undefined, engine: {} as never })
  assert.throws(() => none.addLocalFogVolume({ id: 'a' }), { code: 'SCENE_LIGHTS_UNAVAILABLE' })
})
