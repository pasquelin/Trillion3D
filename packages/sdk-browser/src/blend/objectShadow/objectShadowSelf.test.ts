// The translucent surfaces read their own object's shadow (`objectShadowSelfWgsl.ts`): the program holds the read only where asked, the layout, the entries and the
// module agree, the atlas is read from a texture or, on a device that cannot spare the second sampled texture, from the packed table, and no pipeline layout passes the limits its
// device holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { BLEND_MODES } from '../../materials/surface/materialBlending.ts'
import { FULL_CONTRACT } from '../../lighting/deferred/contractCuts.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { BLEND_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { blendBindEntries, blendLayoutEntries } from '../../gpu/bind/blendBindEntries.ts'
import {
  BLEND_OBJECT_SHADOW_BINDINGS as B,
  OBJECT_SHADOW_RECORD_WORDS,
  objectShadowAtlasRead,
} from '../../gpu/core/objectShadowRead.ts'
import { blendLayoutsFor } from '../groupLayouts.ts'
import { OBJECT_SHADOW_DEPTH_FOLD_WGSL } from './objectShadowDepthFold.ts'
import { blendShader } from '../shader.ts'
import { createWebgpuBlendPipelines } from '../pipelines.ts'
import type { BlendGpuItem } from '../state.ts'
import { NO_VERTEX_READS } from '../cloudVertexText.ts'

const volume = { translucencyVolume: true }

test('the device reads the atlas from the texture where it spares two sampled ones, from the packed table where it spares one, else not at all', () => {
  const read = (limits: Record<string, number>) => objectShadowAtlasRead({ limits } as never)
  // Sixteen sampled textures: the widest stage is full, the packed table is a seventeenth: it takes the place of the light profiles' atlas, read from it (folded).
  assert.equal(read({ maxSampledTexturesPerShaderStage: 16 }), 'folded')
  // Seventeen: the rectangle lights' pictures fill it (folded again). Eighteen: the pictures and the packed table. Nineteen to twenty-two: the pictures, the packed table and the atlas.
  assert.equal(read({ maxSampledTexturesPerShaderStage: 17 }), 'folded')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 18 }), 'packed')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 19 }), 'texture')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 22 }), 'texture')
  // Twenty-three: the reflection group fills it; twenty-four holds the packed table, twenty-five both.
  assert.equal(read({ maxSampledTexturesPerShaderStage: 23 }), 'folded')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 24 }), 'packed')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 25 }), 'texture')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 128 }), 'texture')
  // No storage buffer is asked: the storage grants change nothing.
  assert.equal(
    read({ maxSampledTexturesPerShaderStage: 24, maxStorageBuffersPerShaderStage: 8 }),
    'packed',
  )
})

test('the sorted translucency’s collect group is counted: its depth texture takes a place of the widest fragment stage', () => {
  const read = (limits: Record<string, number>) => objectShadowAtlasRead({ limits } as never, true)
  assert.equal(read({ maxSampledTexturesPerShaderStage: 24 }), 'folded')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 25 }), 'packed')
  assert.equal(read({ maxSampledTexturesPerShaderStage: 26 }), 'texture')
  const { device } = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 25 } })
  assert.equal(blendLayoutsFor(device, true, false).read, 'texture')
  assert.equal(blendLayoutsFor(device, true, true).read, 'packed')
})

test('the module holds the read only where asked, from the texture or from the packed table, and assembles', () => {
  const plain = blendShader({}, volume)
  assert.ok(!/selfShadow|SelfShadow|selfAtlas/.test(plain))
  for (const read of ['texture', 'packed'] as const) {
    const code = blendShader({}, { ...volume, objectShadow: read })
    assertProgramAssembles(code, 'vs', `the blend module reading its object's shadow (${read})`)
    assert.match(code, /fn translucencyVolumeLightSelf\(/)
    assert.match(code, /fn selfShadowRecordOf\(in:VSOut\)->u32/)
    assert.match(code, /translucencyVolumeLightSelf\(s\.rgb,s\.metal,s\.N,in\.view,/)
    assert.match(code, /objectShadowSeries\(/)
    assert.match(code, /fn selfRecordAt\(first:u32\)->SelfShadow/)
    assert.ok(!/var<uniform> selfShadows|array<SelfShadow/.test(code), 'no record cap')
    assert.ok(code.includes(`@binding(${B.packed}) var selfPacked:texture_2d_array<u32>`))
    assert.equal(
      code.includes(`@binding(${B.atlas}) var selfAtlas:texture_2d_array<f32>`),
      read === 'texture',
    )
    assert.ok(!/var<storage,read> selfAtlas/.test(code), 'no storage buffer for the atlas')
    // The record rides a lane of the vertex stage's extras: no location past the sixteen.
    assert.match(code, /extras0:vec4f/)
    assert.ok(!/@location\(1[6-9]\)/.test(code))
  }
  // Without the volume read the option is not a read.
  assert.equal(blendShader({}, { objectShadow: 'texture' }), blendShader({}))
})

test('the record takes a lane after the fog and the clouds, and no new location where a vector has a lane left', () => {
  const locations = (reads: { clouds: boolean; fog: boolean }, objectShadow?: 'texture') =>
    [
      ...blendShader({}, { ...volume, reads, objectShadow }).matchAll(
        /@location\((\d+)\) extras\d+:vec4f/g,
      ),
    ].length
  assert.deepEqual(
    [
      locations(NO_VERTEX_READS),
      locations({ clouds: false, fog: true }),
      locations({ clouds: true, fog: true }),
    ],
    [0, 1, 2],
  )
  assert.deepEqual(
    [
      locations(NO_VERTEX_READS, 'texture'),
      locations({ clouds: false, fog: true }, 'texture'),
      locations({ clouds: true, fog: true }, 'texture'),
    ],
    [1, 2, 2],
  )
})

test('the layout, the entries and the module hold the read together', () => {
  fakeDevice()
  const at = (entries: GPUBindGroupLayoutEntry[]) => entries.map((e) => e.binding)
  const plain = at(blendLayoutEntries(208))
  const extended = (read: 'texture' | 'packed') => blendLayoutEntries(208, false, false, read)
  const added = (read: 'texture' | 'packed') => at(extended(read)).filter((b) => !plain.includes(b))
  assert.deepEqual(added('texture'), [B.atlas, B.packed])
  assert.deepEqual(added('packed'), [B.packed])
  assert.equal(
    extended('texture').find((e) => e.binding === B.atlas)!.texture?.viewDimension,
    '2d-array',
  )
  // The packed table is the one binding both stages read; no storage buffer and no uniform buffer is added.
  const packed = extended('packed').find((e) => e.binding === B.packed)!
  assert.equal(packed.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)
  assert.equal(packed.texture?.sampleType, 'uint')
  const kinds = (entries: GPUBindGroupLayoutEntry[]) => entries.filter((e) => e.buffer).length
  assert.equal(kinds(extended('texture')), kinds(blendLayoutEntries(208)))
  const resources = new Proxy({}, { get: () => ({}) }) as never
  const entries = (read?: 'texture' | 'packed') =>
    blendBindEntries(resources, false, read).map((e) => e.binding)
  assert.deepEqual(
    entries('texture').filter((b) => !entries().includes(b)),
    [B.atlas, B.packed],
  )
  assert.deepEqual(
    entries('packed').filter((b) => !entries().includes(b)),
    [B.packed],
  )
})

test('the default layouts stay as they were: the extended ones exist where the session reads and the device grants', () => {
  const { device } = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 25 } })
  const off = blendLayoutsFor(device, false)
  const on = blendLayoutsFor(device, true)
  assert.equal(off.read, undefined)
  assert.equal(on.read, 'texture')
  assert.notEqual(on.full, off.full)
  assert.equal(on.full, on.filtered)
  const narrow = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 16 } }).device
  // The base device: the read is there, the packed table in the place of the profiles' atlas; the default layouts are as ever.
  assert.equal(blendLayoutsFor(narrow, true).read, 'folded')
  assert.notEqual(blendLayoutsFor(narrow, true).full, blendLayoutsFor(narrow, false).full)
  assert.equal(blendLayoutsFor(narrow, false).read, undefined)
  // Where the sorted translucency's depth texture also takes a place, sixteen folds that one into the table too.
  assert.equal(blendLayoutsFor(narrow, true, true).read, 'foldedDepth')
  // One texture fewer holds no read.
  const bare = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 15 } }).device
  assert.equal(blendLayoutsFor(bare, true, true).read, undefined)
})

/** The blends built on a device with `limits`, reading their object's shadow: the widest fragment stage's count of each kind. */
async function build(limits: Record<string, number>, oit = false) {
  const { device, pipelineLayouts: layouts } = fakeDevice({ limits })
  const items = [...BLEND_MODES, 'normal' as const].map((blending) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending, contactShadows: true, translucencyLighting: 'volume' })
    return { surface: surfaceOf(surface), transmissive: false }
  }) as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: assert.ifError }
  const { blendPipelines } = await createWebgpuBlendPipelines(
    device,
    items,
    undefined,
    true,
    undefined,
    false,
    { lit, world: { exclusion: false, objectShadow: true }, oit },
  )
  const widest: Record<string, number> = {}
  for (const layout of layouts)
    for (const { limit, kind, count } of stageBindingCounts(layout)) {
      assert.ok(count <= limitOf(limit, device.limits as never), `${kind}: ${count}`)
      if (kind.endsWith('Fragment')) widest[limit] = Math.max(widest[limit] ?? 0, count)
    }
  return { widest, blendPipelines }
}

test('no pipeline layout passes the limits of its device, whichever way the atlas is read', async () => {
  // The packed table where the device spares one past the 17 of the pictures (18 of 18, the mask's group included): the atlas copied into it.
  const packed = await build({ maxSampledTexturesPerShaderStage: 18 })
  assert.equal(packed.blendPipelines.objectShadowRead, 'packed')
  assert.equal(packed.widest.maxSampledTexturesPerShaderStage, 18)
  // The texture where it spares one more.
  const texture = await build({ maxSampledTexturesPerShaderStage: 19 })
  assert.equal(texture.blendPipelines.objectShadowRead, 'texture')
  assert.equal(texture.widest.maxSampledTexturesPerShaderStage, 19)
  // Whichever way, the storage buffers stay at the eight WebGPU guarantees.
  assert.equal(packed.widest.maxStorageBuffersPerShaderStage, 8)
  assert.equal(texture.widest.maxStorageBuffersPerShaderStage, 8)
})

test('a device that spares no sampled texture builds the programs without the read, and says it was asked', async () => {
  const { device } = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 15 } })
  assert.equal(objectShadowAtlasRead(device), undefined)
  assert.equal(objectShadowAtlasRead(device, true), undefined)
})

test('sixteen sampled textures with the sorted translucency fold its depth into the table: no depth binding, the fragments read the table', () => {
  const { device } = fakeDevice({ limits: { maxSampledTexturesPerShaderStage: 16 } })
  assert.equal(objectShadowAtlasRead(device, true), 'foldedDepth')
  // Seventeen with the pictures, twenty-three with the reflection group: one texture short, the same fold.
  for (const sampled of [17, 23])
    assert.equal(
      objectShadowAtlasRead(
        fakeDevice({ limits: { maxSampledTexturesPerShaderStage: sampled } }).device,
        true,
      ),
      'foldedDepth',
    )
  const code = blendShader({}, { translucencyVolume: true, objectShadow: 'foldedDepth', oit: true })
  assertProgramAssembles(code, 'vs', 'the blend module folding the sorted depth')
  assert.match(code, /fn oitSceneDepth\(pixel:vec2u\)->f32\{\n let head=selfPackedAt\(1u,0u\)/)
  assert.ok(!/var oitDepth/.test(code))
  assert.ok(/fn lightProfileFolded/.test(code) && !/var lightProfileAtlas/.test(code))
  // Without the fold the program tests against the texture.
  const textured = blendShader({}, { translucencyVolume: true, objectShadow: 'folded', oit: true })
  assert.match(textured, /var oitDepth:texture_depth_2d/)
  assert.ok(!/fn oitSceneDepth\(pixel:vec2u\)->f32\{\n let head/.test(textured))
  // The pass that writes the depth into the table.
  assertProgramAssembles(OBJECT_SHADOW_DEPTH_FOLD_WGSL, 'depthFold', 'the depth fold pass')
})

test('the base device (sixteen sampled textures) reads the object shadow, the profiles read from the packed table, no layout passes sixteen', async () => {
  const { widest, blendPipelines } = await build({ maxSampledTexturesPerShaderStage: 16 })
  assert.equal(blendPipelines.objectShadowRead, 'folded')
  assert.equal(widest.maxSampledTexturesPerShaderStage, 16)
  assert.equal(widest.maxStorageBuffersPerShaderStage, 8)
})

test('sixteen sampled textures with the sorted translucency: the read is there, the collect group binds no depth, no layout passes sixteen', async () => {
  const { widest, blendPipelines } = await build(
    { maxSampledTexturesPerShaderStage: 16, maxStorageBuffersPerShaderStage: 10 },
    true,
  )
  assert.equal(blendPipelines.objectShadowRead, 'foldedDepth')
  assert.ok(blendPipelines.oit)
  assert.equal(widest.maxSampledTexturesPerShaderStage, 16)
})

test('the folded layout drops the profiles atlas for the packed table, and the program reads the profiles from it', () => {
  fakeDevice()
  const bindings = (entries: GPUBindGroupLayoutEntry[]) => entries.map((e) => e.binding)
  const plain = bindings(blendLayoutEntries(208))
  const folded = bindings(blendLayoutEntries(208, false, false, 'folded'))
  assert.deepEqual(
    plain.filter((b) => !folded.includes(b)),
    [BLEND_BINDINGS.lightProfileAtlas],
  )
  assert.deepEqual(
    folded.filter((b) => !plain.includes(b)),
    [B.packed],
  )
  const resources = new Proxy({}, { get: () => ({}) }) as never
  assert.ok(
    !blendBindEntries(resources, false, 'folded').some(
      (e) => e.binding === BLEND_BINDINGS.lightProfileAtlas,
    ),
  )
  const code = blendShader({}, { translucencyVolume: true, objectShadow: 'folded' })
  assert.ok(/fn lightProfileFolded/.test(code) && !/var lightProfileAtlas/.test(code))
  assert.ok(!/@binding\(${BLEND_BINDINGS.lightProfileAtlas}\)/.test(code))
  // Without a volume the program still reads the profiles from the table.
  assert.ok(/fn lightProfileFolded/.test(blendShader({}, { objectShadow: 'folded' })))
  // The default text keeps the atlas.
  assert.ok(/var lightProfileAtlas/.test(blendShader()))
  assertProgramAssembles(code)
})

test('the record the shader declares holds as many words as the writer lays out, and there is no cap on how many', () => {
  const code = blendShader({}, { ...volume, objectShadow: 'texture' })
  const body = /struct SelfShadow\{([^}]*)\}/.exec(code)![1]!
  const words = (type: string) => (type === 'mat4x4f' ? 16 : 4)
  const total = [...body.matchAll(/\w+:(\w+),/g)].reduce((sum, m) => sum + words(m[1]!), 0)
  assert.equal(total, OBJECT_SHADOW_RECORD_WORDS)
  // It is read from this many texels of the packed table.
  const reads = [...code.matchAll(/selfPackedTexel\(first(?:\+(\d+)u)?\)/g)].length
  assert.equal(reads, OBJECT_SHADOW_RECORD_WORDS / 4)
})
