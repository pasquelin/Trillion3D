// The groups of a view's kernels (`createScreenProbeGroups`) are made for the inputs the image gives, and made again whenever those are other
// than the last image's, an input that comes back included: the groups held for the inputs that left are never handed out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScreenProbeGroups } from './screen/groups.ts'
import type { ScreenProbeInputs } from './screen/groupParts.ts'
import type { ScreenProbeKernels } from './screen/kernels.ts'
import type { ScreenProbeResources } from './screen/resources.ts'
import { TILE_OVERFLOW_BINDINGS } from './screen/integratePassWgsl.ts'
import { closureRegionOf } from '../../visibility/closureTiles/closureTilesWgsl.ts'

/** Inputs whose every resource is an object of its own, tagged `tag`. */
const inputsOf = (tag: string, closures = 0) => {
  const one = (name: string) => ({ tag, name })
  const hit = Object.fromEntries(
    ['tables', 'depth', 'final', 'grid', 'instances'].map((name) => [name, one(name)]),
  )
  const views = Object.fromEntries(
    [
      'normals',
      'flags',
      'lobes',
      'base',
      'emissiveAo',
      'lights',
      'bounceGrid',
      'probes',
      'vectors',
      'blue',
      'cacheFinal',
      'cacheRaw',
      'cacheSky',
    ].map((name) => [name, one(name)]),
  )
  const fog = { cubemap: one('fogCubemap'), sampler: one('fogSampler') }
  return {
    ...views,
    closureNormals: Array.from({ length: closures }, (_, at) => one(`closureNormals ${at}`)),
    hit,
    fog,
    field: { readGeneration: 1, readEntries: () => [] },
  } as unknown as ScreenProbeInputs
}

/** A stand-in for a structure the groups only name: any field of it is another stand-in. */
const stub = (): object =>
  new Proxy(() => undefined, {
    get: (_, key) => (typeof key === 'symbol' || key === 'then' ? undefined : stub()),
  })

/** `fields` over a stand-in: a field it names is its own, any other is a stand-in. */
const withStubs = (fields: Record<string, unknown>) =>
  new Proxy(fields, { get: (target, key: string) => (key in target ? target[key] : stub()) })

test('a group set is made again when an input comes back after another, never the set held for the one that left', () => {
  const made: GPUBindGroupDescriptor[] = []
  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice
  const kernel = { layout: {}, pipelines: {} }
  const kernels = {
    features: {},
    occlusion: kernel,
    temporal: kernel,
    // The kernels over the probes: each one a kernel of the same kind, the levels of the filtered radiance none.
    cast: new Proxy({ mips: [] } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : kernel),
    }),
  } as unknown as ScreenProbeKernels
  const pair = () => [{}, {}]
  const resources = withStubs({
    params: {},
    counts: {},
    pixels: {},
    normal: {},
    light: {},
    rough: {},
    back: {},
    occlusion: {},
    info: pair(),
    history: pair(),
    shading: pair(),
    keptDepth: pair(),
  }) as unknown as ScreenProbeResources
  const groupsOf = createScreenProbeGroups(device, kernels, resources, [])
  const a = inputsOf('a'),
    b = inputsOf('b')
  const first = groupsOf(0, a)
  assert.equal(groupsOf(0, a), first, 'the same inputs: the set held')
  const second = groupsOf(0, b)
  assert.notEqual(second, first)
  const back = groupsOf(0, a)
  assert.notEqual(back, second, 'the inputs are the first’s again, not the second’s')
  const noisedBy = (set: typeof first, inputs: ScreenProbeInputs) =>
    ((set.occlusion as unknown as GPUBindGroupDescriptor).entries as GPUBindGroupEntry[]).some(
      (entry) => entry.resource === inputs.blue,
    )
  assert.ok(
    noisedBy(back, a) && !noisedBy(back, b),
    'the occlusion pass reads the first inputs’ noise',
  )
  assert.ok(noisedBy(second, b) && !noisedBy(second, a), 'and the second set the second’s')
})

test("the pixels of each closure past the first have groups of their own over the closure's normals and textures, and move with them", () => {
  const made: GPUBindGroupDescriptor[] = []
  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice
  const kernel = { layout: {}, pipelines: {} }
  const kernels = {
    features: {},
    occlusion: kernel,
    temporal: kernel,
    cast: new Proxy({ mips: [] } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : kernel),
    }),
  } as unknown as ScreenProbeKernels
  const pair = () => [{}, {}]
  const own = () => ({
    light: {},
    rough: {},
    back: {},
    occlusion: {},
    offsets: {},
    shortRangeGi: {},
    shortRangeGiHistory: pair(),
    history: pair(),
    shading: pair(),
    keptDepth: pair(),
  })
  const sets = [own(), own()]
  const resources = withStubs({
    params: {},
    counts: {},
    pixels: {},
    normal: {},
    header: {},
    indices: {},
    moving: {},
    tileList: {},
    tileArgs: {},
    irradiance: {},
    mips: { all: {}, levels: [{}] },
    ...own(),
    info: pair(),
    closures: { held: 3, sets },
  }) as unknown as ScreenProbeResources
  const groupsOf = createScreenProbeGroups(device, kernels, resources, [])
  const a = inputsOf('a', 2)
  // The closures past the first are over their regions of the closure tiles' list (their occlusion and integration run over the overflow tiles).
  a.closureTiles = { list: {} as GPUBuffer, args: {} as GPUBuffer, tiles: [4, 3], closures: 3 }
  const set = groupsOf(0, a)
  assert.equal(set.closures.length, 2, 'a group set for each closure past the first')
  const entriesOf = (group: unknown) =>
    (group as unknown as GPUBindGroupDescriptor).entries as GPUBindGroupEntry[]
  const reads = (group: unknown, resource: unknown) =>
    entriesOf(group).some((entry) => entry.resource === resource)
  // The closure's occlusion pass reads its own normals and writes its own texture, and the first closure's pass is left as it was.
  for (const [at, closure] of set.closures.entries()) {
    assert.ok(reads(closure.occlusion, a.closureNormals[at]), `closure ${at + 1} reads its normals`)
    assert.ok(reads(closure.occlusion, sets[at]!.occlusion), `and writes its occlusion`)
    assert.ok(reads(closure.occlusion, a.flags), "under the first closure's flags")
    assert.ok(!reads(set.occlusion, a.closureNormals[at]))
    assert.ok(reads(closure.temporal, sets[at]!.history[0]), 'and keeps its own history')
  }
  assert.ok(reads(set.occlusion, a.normals))
  assert.equal(groupsOf(0, a), set, 'the same inputs: the set held')
  // A closure's normals replaced: the groups are made again.
  const next = inputsOf('a', 2)
  next.closureNormals = [a.closureNormals[0]!, { tag: 'other' } as unknown as GPUTextureView]
  Object.assign(next, { ...a, closureNormals: next.closureNormals })
  assert.notEqual(groupsOf(0, next), set)
  // A view of one closure holds none.
  const one = createScreenProbeGroups(
    device,
    kernels,
    withStubs({
      ...own(),
      params: {},
      counts: {},
      pixels: {},
      normal: {},
      info: pair(),
      closures: undefined,
    }) as unknown as ScreenProbeResources,
    [],
  )
  assert.deepEqual(one(0, inputsOf('b')).closures, [])
})

test("the tile classification of a closure past the first is over the overflow kernels and its region of the closure tiles' list, and moves with the list", () => {
  const made: GPUBindGroupDescriptor[] = []
  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice
  const named = (name: string) => ({ layout: { name }, pipelines: {} })
  const kernel = named('plain')
  const kernels = {
    features: {},
    occlusion: kernel,
    temporal: kernel,
    cast: new Proxy({ mips: [] } as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target ? target[key] : key.endsWith('Overflow') ? named(key) : kernel,
    }),
  } as unknown as ScreenProbeKernels
  const pair = () => [{}, {}]
  const own = () => ({
    light: {},
    rough: {},
    back: {},
    occlusion: {},
    offsets: {},
    shortRangeGi: {},
    shortRangeGiHistory: pair(),
    history: pair(),
    shading: pair(),
    keptDepth: pair(),
  })
  const resources = withStubs({
    params: {},
    counts: {},
    pixels: {},
    normal: {},
    header: {},
    indices: {},
    moving: {},
    tileList: {},
    tileArgs: {},
    irradiance: {},
    mips: { all: {}, levels: [{}] },
    ...own(),
    info: pair(),
    closures: { held: 3, sets: [own(), own()] },
  }) as unknown as ScreenProbeResources
  const groupsOf = createScreenProbeGroups(device, kernels, resources, [])
  const list = { tag: 'list' } as unknown as GPUBuffer
  const tiles = [4, 3] as const
  const a = inputsOf('a', 2)
  a.closureTiles = { list, args: {} as GPUBuffer, tiles, closures: 3 }
  const set = groupsOf(0, a)
  const layoutOf = (group: unknown) =>
    ((group as GPUBindGroupDescriptor).layout as unknown as { name: string }).name
  const region = (group: unknown) =>
    ((group as GPUBindGroupDescriptor).entries as GPUBindGroupEntry[]).find(
      (entry) => entry.binding === TILE_OVERFLOW_BINDINGS.at.overflow,
    )?.resource
  assert.equal(layoutOf(set.tile), 'plain', "the first closure's tiles are the view's")
  assert.equal(region(set.tile), undefined)
  for (const [at, closure] of set.closures.entries()) {
    assert.equal(layoutOf(closure.tile), 'tileOverflow')
    assert.equal(layoutOf(closure.integrate), 'integrateOverflow')
    assert.deepEqual(region(closure.tile), { buffer: list, ...closureRegionOf(tiles, at + 1) })
  }
  assert.equal(groupsOf(0, a), set)
  // The list made again (the view grew): the groups are made again over the new one.
  const grown = inputsOf('a', 2)
  Object.assign(grown, a, { closureTiles: { ...a.closureTiles, list: { tag: 'bigger' } } })
  assert.notEqual(groupsOf(0, grown), set)
  // Where the view lists none yet, a closure past the first has no classification group: it integrates none this image.
  const none = inputsOf('c', 2)
  assert.equal(
    createScreenProbeGroups(device, kernels, resources, [])(0, none).closures[0]!.tile,
    undefined,
  )
})
