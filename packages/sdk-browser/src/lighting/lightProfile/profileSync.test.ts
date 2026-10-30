// The sync of the lights with the atlas: a slot for each profile a light names, counted, the slice in
// the light's lane, and nothing done when nothing changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createLightProfileAtlas } from './profileAtlas.ts'
import { PROFILE_SIDE, type LightProfileData } from './profileCodec.ts'
import {
  createLightProfileRegistry,
  createLightProfileSync,
  requestLightProfiles,
  type ProfileStore,
} from './profileSync.ts'

const data = (): LightProfileData => ({
  texels: new Uint16Array(PROFILE_SIDE * PROFILE_SIDE),
})

/** A store of lights that name profiles, writing what the sync hands it where it can be read. */
function fakeStore() {
  const lights = new Map<string, string | undefined>()
  const slices: number[] = []
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
  }
  return {
    store,
    slices,
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

/** The atlas's settings: the reference's 256 texels a slice, 32 profiles at most. */
const SETTINGS = [256, 32] as const

function rig() {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  const registry = createLightProfileRegistry()
  return { gpu, atlas, registry, sync: createLightProfileSync(atlas, registry), ...fakeStore() }
}

test('lights naming one profile share a slice, the others have none', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  r.set('b', undefined)
  r.set('c', 'p')
  r.set('d', 'unloaded')
  r.sync.sync(r.store, ...SETTINGS)
  assert.deepEqual(r.slices, [0, -1, 0, -1])
  assert.equal(r.atlas.slots.refsOf('p'), 2)
  assert.equal(r.gpu.textureWrites.length, 1, 'written once')
})

test('a profile that loads later reaches the lights that named it', () => {
  const r = rig()
  r.set('a', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  assert.deepEqual(r.slices, [-1])
  r.registry.register('p', data())
  r.sync.sync(r.store, ...SETTINGS)
  assert.deepEqual(r.slices, [0])
})

test('a light that goes or changes its profile frees its hold', () => {
  const r = rig()
  r.registry.register('p', data())
  r.registry.register('q', data())
  r.set('a', 'p')
  r.set('b', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.atlas.slots.refsOf('p'), 2)
  r.set('b', 'q')
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.atlas.slots.refsOf('p'), 1)
  assert.deepEqual(r.slices, [r.slices[0], r.slices[1]])
  assert.notEqual(r.slices[0], r.slices[1])
  r.remove('a')
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.atlas.slots.refsOf('p'), 0, 'the last light freed the slot')
})

test('a sync with nothing changed does nothing, and reports when the texture was made', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  assert.equal(r.sync.sync(r.store, ...SETTINGS), true, 'the first texture')
  const writes = r.gpu.textureWrites.length
  assert.equal(r.sync.sync(r.store, ...SETTINGS), false)
  assert.equal(r.gpu.textureWrites.length, writes)
  r.registry.register('q', data())
  r.set('b', 'q')
  const grown = r.sync.sync(r.store, ...SETTINGS)
  assert.equal(grown, true, 'a second profile: more slices asked, the texture is made again')
  assert.equal(r.gpu.textureWrites.length, writes + 2, 'and both are written into it')
  assert.equal(r.gpu.textures.at(-1)!.depthOrArrayLayers, 2, 'with the slices asked')
})

test('a setting of the atlas that moves makes it again, written again, and leaves the sync out of date until then', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.sync.upToDate(r.store, 128, 32), false)
  assert.equal(r.sync.upToDate(r.store, 256, 16), false)
  const writes = r.gpu.textureWrites.length
  assert.equal(r.sync.sync(r.store, 128, 32), true)
  assert.equal(r.gpu.textureWrites.length, writes + 1)
  assert.deepEqual(r.gpu.textures.at(-1)!.width, 128)
  assert.equal(r.sync.upToDate(r.store, 128, 32), true)
  assert.deepEqual(r.slices, [0])
})

test('a store change that moves no profile wakes nothing', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  const writes = r.gpu.textureWrites.length
  let assigned = 0
  const assign = r.store.assignLightProfile
  r.store.assignLightProfile = (slot, slice) => {
    assigned++
    assign(slot, slice)
  }
  r.sync.sync(r.store, ...SETTINGS)
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
    return data()
  }
  await Promise.all(requestLightProfiles(r.store, r.registry, load))
  await Promise.all(requestLightProfiles(r.store, r.registry, load))
  assert.deepEqual(asked, ['p'])
  assert.ok(r.registry.get('p'))
  // A profile the loader does not find is not registered, and not asked again.
  r.set('d', 'missing')
  await Promise.all(requestLightProfiles(r.store, r.registry, async () => undefined))
  assert.equal(r.registry.get('missing'), undefined)
  assert.deepEqual(requestLightProfiles(r.store, r.registry, load), [])
})

test('a profile that arrives after the last sync, or a light that names one, leaves the sync out of date until the next', () => {
  const r = rig()
  r.set('a', 'p')
  assert.equal(r.sync.upToDate(r.store, ...SETTINGS), false, 'never synced')
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.sync.upToDate(r.store, ...SETTINGS), true)
  r.registry.register('p', data())
  assert.equal(
    r.sync.upToDate(r.store, ...SETTINGS),
    false,
    'the file arrived: the light has no slice yet',
  )
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.sync.upToDate(r.store, ...SETTINGS), true)
  assert.deepEqual(r.slices, [0])
})

test('an atlas whose texture was handed back is made again by the next profile, in a slice it is free to give', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  r.remove('a')
  r.sync.sync(r.store, ...SETTINGS)
  r.atlas.destroy()
  r.registry.register('q', data())
  r.set('b', 'q')
  assert.equal(r.sync.sync(r.store, ...SETTINGS), true, 'the texture is made again')
  assert.ok(r.atlas.slots.sliceOf('q') >= 0, 'it has a slice')
  assert.equal(r.gpu.textures.length, 2)
})

test('a forced sync writes the atlas again when the store and the registry have not moved', () => {
  const r = rig()
  r.registry.register('p', data())
  r.set('a', 'p')
  r.sync.sync(r.store, ...SETTINGS)
  const written = r.gpu.textureWrites.length
  r.sync.sync(r.store, ...SETTINGS)
  assert.equal(r.gpu.textureWrites.length, written, 'nothing moved: nothing written')
  r.sync.sync(r.store, ...SETTINGS, true)
  assert.equal(r.gpu.textureWrites.length, written + 1)
})
