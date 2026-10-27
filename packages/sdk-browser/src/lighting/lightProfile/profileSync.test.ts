// The sync of the lights with the atlas: a slot for each profile a light names, counted, the slice in
// the light's lane, the brightness in the store, and nothing done when nothing changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createLightProfileAtlas } from './profileAtlas.ts'
import { PROFILE_SIDE, type LightProfileData } from './profileFile.ts'
import {
  createLightProfileRegistry,
  createLightProfileSync,
  requestLightProfiles,
  type ProfileStore,
} from './profileSync.ts'

const data = (brightness: number): LightProfileData => ({
  brightness,
  texels: new Uint16Array(PROFILE_SIDE * PROFILE_SIDE),
})

/** A store of lights that name profiles, writing what the sync hands it where it can be read. */
function fakeStore() {
  const lights = new Map<string, string | undefined>()
  const slices: number[] = []
  const brightness = new Map<string, number>()
  let profileEpoch = 1
  const store: ProfileStore = {
    get count() {
      return lights.size
    },
    get ids() {
      return [...lights.keys()]
    },
    get profileEpoch() {
      return profileEpoch
    },
    light: (id) => (lights.has(id) ? { iesProfile: lights.get(id) } : undefined),
    assignLightProfile(slot, slice) {
      slices[slot] = slice
    },
    setProfileBrightness(profile, value) {
      brightness.set(profile, value)
    },
  }
  return {
    store,
    slices,
    brightness,
    set: (id: string, profile?: string) => {
      lights.set(id, profile)
      profileEpoch++
    },
    remove: (id: string) => {
      lights.delete(id)
      profileEpoch++
    },
  }
}

function rig() {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  const registry = createLightProfileRegistry()
  return { gpu, atlas, registry, sync: createLightProfileSync(atlas, registry), ...fakeStore() }
}

test('lights naming one profile share a slice, the others have none, and the brightness reaches the store', () => {
  const r = rig()
  r.registry.register('p', data(900))
  r.set('a', 'p')
  r.set('b', undefined)
  r.set('c', 'p')
  r.set('d', 'unloaded')
  r.sync.sync(r.store)
  assert.deepEqual(r.slices, [0, -1, 0, -1])
  assert.equal(r.atlas.slots.refsOf('p'), 2)
  assert.equal(r.brightness.get('p'), 900)
  assert.equal(r.gpu.textureWrites.length, 1, 'written once')
})

test('a profile that loads later reaches the lights that named it', () => {
  const r = rig()
  r.set('a', 'p')
  r.sync.sync(r.store)
  assert.deepEqual(r.slices, [-1])
  r.registry.register('p', data(500))
  r.sync.sync(r.store)
  assert.deepEqual(r.slices, [0])
  assert.equal(r.brightness.get('p'), 500)
})

test('a light that goes or changes its profile frees its hold', () => {
  const r = rig()
  r.registry.register('p', data(1))
  r.registry.register('q', data(2))
  r.set('a', 'p')
  r.set('b', 'p')
  r.sync.sync(r.store)
  assert.equal(r.atlas.slots.refsOf('p'), 2)
  r.set('b', 'q')
  r.sync.sync(r.store)
  assert.equal(r.atlas.slots.refsOf('p'), 1)
  assert.deepEqual(r.slices, [r.slices[0], r.slices[1]])
  assert.notEqual(r.slices[0], r.slices[1])
  r.remove('a')
  r.sync.sync(r.store)
  assert.equal(r.atlas.slots.refsOf('p'), 0, 'the last light freed the slot')
})

test('a sync with nothing changed does nothing, and reports when the texture was made', () => {
  const r = rig()
  r.registry.register('p', data(1))
  r.set('a', 'p')
  assert.equal(r.sync.sync(r.store), true, 'the first texture')
  const writes = r.gpu.textureWrites.length
  assert.equal(r.sync.sync(r.store), false)
  assert.equal(r.gpu.textureWrites.length, writes)
  r.registry.register('q', data(2))
  r.set('b', 'q')
  assert.equal(r.sync.sync(r.store), false, 'a second slice: the texture stays')
  assert.equal(r.gpu.textureWrites.length, writes + 1)
})

test('a store change that moves no profile wakes nothing', () => {
  const r = rig()
  r.registry.register('p', data(1))
  r.set('a', 'p')
  r.sync.sync(r.store)
  const writes = r.gpu.textureWrites.length
  let assigned = 0
  const assign = r.store.assignLightProfile
  r.store.assignLightProfile = (slot, slice) => {
    assigned++
    assign(slot, slice)
  }
  r.sync.sync(r.store)
  assert.equal(assigned, 0, 'the lights are not walked')
  assert.equal(r.gpu.textureWrites.length, writes)
})

test('a profile is asked for once, whatever the number of lights that name it', async () => {
  const r = rig()
  r.set('a', 'p')
  r.set('b', 'p')
  r.set('c', undefined)
  const asked: string[] = []
  const load = async (id: string) => {
    asked.push(id)
    return data(700)
  }
  await Promise.all(requestLightProfiles(r.store, r.registry, load))
  await Promise.all(requestLightProfiles(r.store, r.registry, load))
  assert.deepEqual(asked, ['p'])
  assert.equal(r.registry.get('p')?.brightness, 700)
  // A profile the loader does not find is not registered, and not asked again.
  r.set('d', 'missing')
  await Promise.all(requestLightProfiles(r.store, r.registry, async () => undefined))
  assert.equal(r.registry.get('missing'), undefined)
  assert.deepEqual(requestLightProfiles(r.store, r.registry, load), [])
})

test('a profile registered again with other data is written again into its slice', () => {
  const r = rig()
  r.registry.register('p', data(1))
  r.set('a', 'p')
  r.sync.sync(r.store)
  const writes = r.gpu.textureWrites.length
  r.registry.register('p', data(2))
  r.sync.sync(r.store)
  assert.equal(r.gpu.textureWrites.length, writes + 1)
  assert.equal(r.brightness.get('p'), 2)
  assert.deepEqual(r.slices, [0], 'the light keeps its slice')
})
