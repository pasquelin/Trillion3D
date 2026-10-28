// The groups of a view's kernels (`createScreenProbeGroups`) are made for the inputs the image gives, and made again whenever those are other
// than the last image's, an input that comes back included: the groups held for the inputs that left are never handed out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScreenProbeGroups } from './screen/groups.ts'
import type { ScreenProbeInputs } from './screen/groupParts.ts'
import type { ScreenProbeKernels } from './screen/kernels.ts'
import type { ScreenProbeResources } from './screen/resources.ts'

/** Inputs whose every resource is an object of its own, tagged `tag`. */
const inputsOf = (tag: string) => {
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
