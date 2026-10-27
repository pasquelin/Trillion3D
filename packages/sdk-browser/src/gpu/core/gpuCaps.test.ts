// The record of what a device can do (`gpuCaps.ts`), read from a fake device in both branches: a
// device that has every optional feature (native), the same device with the test switch
// `trillion3dGpuFeaturesOff` naming them off, and one that has none (polyfill).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BLOCK_FEATURES,
  FEATURE,
  branchTags,
  gpuCapsFrom,
  gpuCapsOf,
  gpuCapsOfFeatures,
  isForcedOff,
  nativeOrPolyfill,
  type Mechanism,
} from './gpuCaps.ts'
import { hasSubgroups, hasSubgroupsOf, uniformSubgroupLanes } from './subgroups.ts'
import { hasWideAtomics } from './wideAtomics.ts'
import { hasTextureFormatsTier1, hasTextureFormatsTier2 } from './textureFormatsTier.ts'

const ALL = [...Object.values(FEATURE), ...Object.values(BLOCK_FEATURES)]
const INFO = {
  vendor: 'v',
  architecture: 'a',
  device: 'd',
  description: 'x',
  subgroupMinSize: 32,
  subgroupMaxSize: 64,
}
const device = (features: string[], adapterInfo: object = INFO) =>
  ({ features: new Set(features), adapterInfo }) as unknown as GPUDevice
/** A device that states no adapter information. */
const bare = (features: string[]) => ({ features: new Set(features) }) as unknown as GPUDevice
const MECHANISMS: Mechanism[] = [
  'subgroups',
  'f16',
  'float32Filterable',
  'float32Blendable',
  'wideAtomics',
  'textureTier1',
  'textureTier2',
  'clipDistances',
  'dualSource',
]

test('a device with every feature is native in every mechanism, and the record is frozen', () => {
  const caps = gpuCapsFrom(new Set(ALL), INFO, [])
  assert.deepEqual(caps.subgroups, { present: true, minLanes: 32, maxLanes: 64, sizeControl: true })
  assert.deepEqual(
    [caps.f16, caps.float32Filterable, caps.float32Blendable, caps.wideAtomics, caps.timestamp],
    [true, true, true, true, true],
  )
  assert.deepEqual(
    [caps.textureTier, caps.dualSource, caps.clipDistances, caps.adapter],
    [2, true, true, 'v|a|d|x'],
  )
  assert.deepEqual(caps.blockFormats, { bc7: true, astc: true, etc2: true })
  for (const mechanism of MECHANISMS)
    assert.deepEqual(nativeOrPolyfill(caps, mechanism), {
      native: true,
      tag: `${mechanism} native`,
    })
  assert.ok(Object.isFrozen(caps) && Object.isFrozen(caps.subgroups))
  assert.ok(Object.isFrozen(caps.blockFormats))
})

test('a device with none takes the polyfill of every mechanism', () => {
  const caps = gpuCapsFrom(new Set(), undefined, [])
  assert.deepEqual(caps.subgroups, { present: false, minLanes: 0, maxLanes: 0, sizeControl: false })
  assert.deepEqual(caps.blockFormats, { bc7: false, astc: false, etc2: false })
  assert.deepEqual(
    [caps.textureTier, caps.timestamp, caps.adapter],
    [0, false, undefined],
    'no adapter stated: no key, which would be every unknown adapter’s',
  )
  for (const mechanism of MECHANISMS)
    assert.deepEqual(nativeOrPolyfill(caps, mechanism), {
      native: false,
      tag: `${mechanism} polyfill`,
    })
  assert.equal(branchTags(caps), MECHANISMS.map((mechanism) => `${mechanism} polyfill`).join(', '))
})

test('the test switch forces the polyfill of the features it names and those they carry', () => {
  const features = new Set(ALL)
  const off = (...names: string[]) => gpuCapsFrom(features, INFO, names)
  assert.equal(off('shader-f16').f16, false)
  assert.equal(off(' shader-f16').f16, false, 'a name keeps the spaces it was written with')
  assert.equal(off('shader-f16').subgroups.present, true, 'the others stay native')
  const noSubgroups = off('subgroups')
  assert.equal(noSubgroups.subgroups.present, false)
  assert.equal(noSubgroups.subgroups.sizeControl, false, 'the size control rides on subgroups')
  assert.equal(off('texture-formats-tier1').textureTier, 0, 'tier 2 rides on tier 1')
  assert.equal(off('texture-formats-tier2').textureTier, 1)
  assert.equal(off('atomic-vec2u-min-max').wideAtomics, false)
  assert.equal(off('texture-compression-bc').blockFormats.bc7, false)
  assert.equal(isForcedOff(['subgroups'], 'subgroup-size-control'), true)
  assert.equal(isForcedOff(['subgroup-size-control'], 'subgroups'), false)
})

test('the address switch reaches the record of a device when it is read, once, and the record is held', () => {
  const scope = globalThis as { location?: unknown },
    had = 'location' in scope,
    before = scope.location
  try {
    scope.location = { search: '' }
    const held = device(ALL)
    const native = gpuCapsOf(held)
    assert.equal(gpuCapsOf(held), native, 'read once, held')
    assert.equal(native.f16, true)
    // The address read at the first ask is the record's: a device read after the switch is forced, the first still native.
    scope.location = { search: '?trillion3dGpuFeaturesOff=shader-f16,subgroups' }
    assert.equal(gpuCapsOf(held), native)
    const forced = gpuCapsOf(device(ALL))
    assert.deepEqual([forced.f16, forced.subgroups.present], [false, false])
    assert.equal(forced.wideAtomics, true)
    assert.equal(hasSubgroups(held), true)
  } finally {
    if (had) scope.location = before
    else delete scope.location
  }
})

test('the record of a device and that of its features alone are each one object, whichever is asked first', () => {
  for (const featuresFirst of [true, false]) {
    const held = device(ALL)
    const [alone, whole] = featuresFirst
      ? [gpuCapsOfFeatures(held.features), gpuCapsOf(held)]
      : [undefined, gpuCapsOf(held)]
    assert.equal(gpuCapsOf(held), whole)
    assert.equal(whole.subgroups.maxLanes, 64, 'the device’s record states its adapter')
    if (alone) {
      assert.equal(gpuCapsOfFeatures(held.features), alone)
      assert.equal(alone.subgroups.maxLanes, 0, 'the features alone state none')
      assert.equal(alone.f16, whole.f16)
    }
  }
})

test('the readers answer what the features and the adapter state', () => {
  const full = device(ALL),
    none = bare([])
  assert.deepEqual([hasSubgroups(full), hasSubgroups(none)], [true, false])
  assert.equal(hasSubgroups(full, 64), true)
  assert.equal(hasSubgroups(full, 128), false, 'the adapter runs no subgroup that wide')
  assert.equal(hasSubgroups(bare(['subgroups']), 128), true, 'no size stated, none refused')
  assert.equal(hasSubgroupsOf(full, 32), false, 'sizes 32 to 64 are not all 32')
  const pinned = device(['subgroups'], { subgroupMinSize: 32, subgroupMaxSize: 32 })
  assert.equal(hasSubgroupsOf(pinned, 32), true)
  assert.equal(uniformSubgroupLanes(pinned, [16, 32] as const), 32)
  assert.equal(uniformSubgroupLanes(none, [16, 32] as const), undefined)
  assert.equal(hasWideAtomics(full), true)
  assert.equal(hasWideAtomics(none), false)
  const tiers = (held: GPUDevice) => [
    hasTextureFormatsTier1(held.features),
    hasTextureFormatsTier2(held),
  ]
  assert.deepEqual(tiers(full), [true, true])
  assert.deepEqual(tiers(device(['texture-formats-tier1'])), [true, false])
  assert.equal(
    gpuCapsOfFeatures(full.features).f16,
    gpuCapsOf(full).f16,
    'the features alone, the same answers',
  )
  assert.equal(gpuCapsOf({} as GPUDevice).timestamp, false, 'a device stating no features has none')
})
