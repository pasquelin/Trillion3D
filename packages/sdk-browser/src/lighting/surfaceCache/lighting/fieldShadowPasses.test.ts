// The shadow passes of an image whose shadows are settled through the distance fields: the masks, then the suns’ meshes and the global field over the
// same light tiles by the same arguments, each group bound where its program declares its buffers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslBindingNumbers } from '../../../gpu/core/wgslBindings.fixture.ts'
import { LIGHT_TILE_ARGS, LIGHT_TILE_ARGS_WORDS } from './layout.ts'
import {
  FIELD_SHADOW_ENTRIES,
  FIELD_SHADOW_MESH_ENTRY,
  FIELD_SHADOW_MESH_WGSL,
  FIELD_SHADOW_WGSL,
} from './fieldShadowWgsl.ts'
import { SHADOW_MASK_ENTRIES } from './shadowMaskWgsl.ts'
import { shadowPasses, type Encoding, type FieldShadows } from './passes.ts'

interface Bound {
  name: string
  group: number
  bindings: number[]
}

/** A kernel that records the group each call binds, its entries read as they would be on the GPU. */
const kernelNamed = (name: string, record: Bound[]) => ({
  group(_identity: unknown, entries: () => { binding: number }[], at = 0) {
    record.push({ name, group: at, bindings: entries().map((e) => e.binding) })
    return { name, at }
  },
  pipeline: (entry: string) => ({ entry }) as unknown as GPUComputePipeline,
})

function run(mesh: boolean) {
  const record: Bound[] = []
  const calls: string[] = []
  const buffer = (label: string) => ({ label }) as unknown as GPUBuffer
  const view = (label: string) => ({ label }) as unknown as GPUTextureView
  const pass = {
    setPipeline: (p: { entry: string }) => calls.push(`pipeline ${p.entry}`),
    setBindGroup: (at: number, group: { name: string }) => calls.push(`group ${at} ${group.name}`),
    dispatchWorkgroupsIndirect: (b: GPUBuffer, offset: number) =>
      calls.push(`indirect ${(b as unknown as { label: string }).label} ${offset}`),
  }
  const shadows: FieldShadows = {
    kernels: {
      shadowMask: kernelNamed('mask', record),
      fieldShadow: kernelNamed('field', record),
    } as unknown as FieldShadows['kernels'],
    buffers: { masks: buffer('masks'), traces: buffer('standIn') },
    mesh: mesh
      ? ({
          lists: { identity: [], entries: () => [{ binding: 1 }] },
          kernel: kernelNamed('mesh', record),
        } as unknown as FieldShadows['mesh'])
      : undefined,
  }
  const e = {
    pass,
    resources: {
      params: buffer('params'),
      context: buffer('context'),
      compactedLightTiles: buffer('tiles'),
      standIn: buffer('standIn'),
    },
    lightSlots: { counts: buffer('counts'), args: buffer('lightArgs') },
    tables: buffer('tables'),
    atlases: {
      physical: { depth: view('depth'), normal: view('normal') },
      factors: buffer('factors'),
    },
    inputs: {
      lights: buffer('lights'),
      lightFunction: view('lf'),
      cloudShadow: { block: buffer('cloud'), maps: [view('c0'), view('c1')], sampler: {} },
      lightProfile: { view: view('profile'), sampler: {} },
      field: {
        readGeneration: 0,
        readEntries: (first: number) => [0, 1, 2, 3, 4, 5].map((k) => ({ binding: first + k })),
      },
    },
    field: shadows,
  } as unknown as Encoding
  shadowPasses(e)
  return { calls, record }
}

const word = (entry: number) => entry * LIGHT_TILE_ARGS_WORDS * 4
const pipelines = (calls: string[]) =>
  calls.filter((c) => c.startsWith('pipeline')).map((c) => c.slice(9))
const indirects = (calls: string[]) => calls.filter((c) => c.startsWith('indirect'))

test('the masks come first, then the field’s pass for each, by the arguments of the lights and of each batchable type', () => {
  const { calls } = run(false)
  assert.deepEqual(pipelines(calls), [...SHADOW_MASK_ENTRIES, ...FIELD_SHADOW_ENTRIES])
  const args = [
    LIGHT_TILE_ARGS.lights,
    ...[0, 1, 2].map((type) => LIGHT_TILE_ARGS.slots + type),
  ].map((entry) => `indirect lightArgs ${word(entry)}`)
  assert.deepEqual(
    indirects(calls),
    [...args, ...args],
    'the same arguments, the masks’ then the field’s',
  )
})

test('the suns’ meshes settle the lights together’s tiles before the global field, by the arguments of the lights together', () => {
  const { calls } = run(true)
  const order = pipelines(calls)
  assert.deepEqual(order.slice(4, 6), [FIELD_SHADOW_MESH_ENTRY, FIELD_SHADOW_ENTRIES[0]])
  assert.equal(indirects(calls)[4], `indirect lightArgs ${word(LIGHT_TILE_ARGS.lights)}`)
  const mesh = calls.indexOf(`pipeline ${FIELD_SHADOW_MESH_ENTRY}`)
  assert.deepEqual(calls.slice(mesh + 1, mesh + 3), ['group 0 mesh', 'group 1 mesh'])
})

test('each group binds where its program declares its buffers', () => {
  const { record } = run(true)
  const declared = (text: string) => wgslBindingNumbers(text).filter((n) => n !== 0 && n < 20)
  const bound = (name: string) =>
    [...new Set(record.find((k) => k.name === name && k.group === 0)!.bindings)].filter(
      (n) => n !== 0,
    )
  assert.deepEqual(
    bound('field')
      .filter((n) => n < 20)
      .sort((a, b) => a - b),
    declared(FIELD_SHADOW_WGSL),
  )
  assert.deepEqual(
    bound('mesh').sort((a, b) => a - b),
    declared(FIELD_SHADOW_MESH_WGSL),
  )
  assert.ok(record.some((k) => k.name === 'mesh' && k.group === 1))
})
