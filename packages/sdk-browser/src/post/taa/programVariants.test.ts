// The programs the device's features choose for the temporal pass — the wave variants, the 16-bit
// ones, the packed formats'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { taaInputs, taaShape, taaSlices } from './frame.fixture.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { createShapeMemo, historyBytesPerPixel } from './historyShape.ts'
import { TAA_LEVEL_KNOBS } from './levels.ts'
import { taaResolveShader } from './resolveWgsl.ts'
import { spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { grantSubgroups, resolveLabelsOf } from './programVariants.fixture.ts'
import { taaExecutionOf, updateTile, type Wave } from './waveOps.ts'

/** A device that grants `features`, with the subgroup sizes its adapter states where given. */
const featuresDevice = (features: string[], min?: number, max?: number) =>
  ({
    features: new Set(features),
    ...(min !== undefined && { adapterInfo: { subgroupMinSize: min, subgroupMaxSize: max } }),
  }) as unknown as GPUDevice

/** The history of an 8 × 4 display at the finest level on a device that grants `granted`. */
const shapeOn = (...granted: GPUFeatureName[]) =>
  createShapeMemo(fakeDevice({ features: granted }).device)(
    TAA_LEVEL_KNOBS.max,
    { frames: 2, interval: 31, packed: true },
    8,
    4,
  )

// A compute pass stores to the 11-11-10 format, the one- and two-channel 8-bit ones and the 16-bit
// ones only under `texture-formats-tier1` (§ 25.19 and § 26.1.1 of the specification): with it the
// history keeps four bytes a colour pixel and one of validity, else the core's half floats, eight,
// and four bytes of validity (the validity is the metadata alone: one channel, no as-is share).
test('the history keeps the packed formats where a compute pass stores to them, the core ones else', () => {
  const packed = shapeOn('texture-formats-tier1'),
    core = shapeOn()
  assert.deepEqual(
    [packed.formats.color, packed.formats.validity, packed.formats.antiAlias],
    ['rg11b10ufloat', 'r8unorm', 'rg8uint'],
  )
  assert.deepEqual(
    [core.formats.color, core.formats.validity, core.formats.antiAlias],
    ['rgba16float', 'rgba8unorm', 'rgba8uint'],
  )
  assert.equal(
    historyBytesPerPixel(packed) * 12,
    historyBytesPerPixel(core) * 5,
    'five bytes a frame pixel against twelve',
  )
  // The packed program declares its stores in those formats and requires the language extension
  // that gives them (§ 4.1.2 and § 6.6.1 of the WGSL specification); the core's names none.
  const packedText = taaResolveShader(false, packed.formats.color, {
    validity: packed.formats.validity,
  })
  assert.match(packedText, /^requires texture_formats_tier1;/)
  assert.match(packedText, /var historyOut:texture_storage_2d<rg11b10ufloat,write>/)
  assert.match(packedText, /var validityOut:texture_storage_2d<r8unorm,write>/)
  assert.doesNotMatch(taaResolveShader(), /requires|enable/)
})

// A subgroup is a workgroup of its lanes: its lane is its place in the tile, a pair of lanes one
// apart across and two apart down the 2 × 2 of a half-size texel, which two shuffles sum. The wave
// variant is chosen where the device grants subgroups at a size the programs are written for.
test('the wave variant is chosen as the device, its adapter and the settings allow', () => {
  const device = featuresDevice
  const wave = (d: GPUDevice, ops = true, size = 0) => taaExecutionOf(d, ops, size).wave
  assert.equal(wave(device([], 32, 32)), undefined, 'no subgroups')
  assert.equal(wave(device(['subgroups'])), undefined, 'sizes the adapter does not state')
  assert.equal(wave(device(['subgroups'], 32, 32), false), undefined, 'switched off')
  assert.deepEqual(wave(device(['subgroups'], 32, 32)), { lanes: 32, pinned: false })
  assert.deepEqual(wave(device(['subgroups'], 64, 64), true, 32), { lanes: 64, pinned: false })
  assert.deepEqual(wave(device(['subgroups'], 128, 128)), undefined, 'a size past the programs')
  const several = ['subgroups', 'subgroup-size-control']
  assert.equal(wave(device(['subgroups'], 8, 32)), undefined, 'sizes it may not pin')
  assert.deepEqual(wave(device(several, 8, 32)), { lanes: 16, pinned: true }, 'the least from 16')
  assert.deepEqual(wave(device(several, 8, 32), true, 32), { lanes: 32, pinned: true })
  assert.deepEqual(
    wave(device(several, 32, 64), true, 16),
    { lanes: 32, pinned: true },
    'a size it lacks',
  )
  // The one object for one choice: a frame that asks again allocates nothing.
  const d = device(several, 8, 32)
  assert.equal(taaExecutionOf(d, true, 0), taaExecutionOf(d, true, 0))
  assert.deepEqual(updateTile(taaExecutionOf(d, true, 0)), [8, 2])
  assert.deepEqual(updateTile(taaExecutionOf(d, false, 0)), [8, 8])
  // In 16 bits a lane takes two pixels, the second as many rows down as the lanes cover: the plain
  // program's 32 lanes cover 8 × 8 as the 32-bit one's 64 do, a wave's lanes twice their rows.
  const f16 = device([...several, 'shader-f16'], 16, 16)
  assert.deepEqual(updateTile(taaExecutionOf(f16, false, 0, true)), [8, 8])
  assert.deepEqual(updateTile(taaExecutionOf(f16, true, 0, true)), [8, 4])
})

test('the wave program gathers the half-size image through the subgroup, the plain one through workgroup memory', () => {
  const text = (wave?: Wave) => taaResolveShader(false, 'rgba16float', { half: true, wave })
  const plain = text()
  assert.match(
    plain,
    /@compute @workgroup_size\(64\)\nfn resolve\(@builtin\(workgroup_id\) wg:vec3u,@builtin\(local_invocation_index\) lane:u32\)/,
  )
  assert.match(plain, /halfTile\[lane\^1u\]/)
  assert.match(plain, /halfTile\[lane\^2u\]/)
  assert.doesNotMatch(plain, /subgroup/)
  const fixed = text({ lanes: 32, pinned: false })
  assert.match(fixed, /^enable subgroups;/)
  assert.match(
    fixed,
    /@compute @workgroup_size\(32\)\nfn resolve\(@builtin\(workgroup_id\) wg:vec3u,@builtin\(subgroup_invocation_id\) lane:u32\)/,
  )
  // The mean crosses lanes as 32-bit floats, the update adding it in its precision (16 bits where
  // granted, two pixels a lane: the loop over a lane's pixels indents it).
  assert.match(
    fixed,
    /mean\+=vec4f\(subgroupShuffleXor\(vec4f\(mean\),1u\)\);\n {2}mean\+=vec4f\(subgroupShuffleXor\(vec4f\(mean\),2u\)\);/,
  )
  assert.match(
    fixed,
    /vec2i\(8,4\)\+lanePixel\(lane\)\+vec2i\(0,px\*4\)/,
    'a tile of 8 across and the lanes over 8 down',
  )
  assert.doesNotMatch(fixed, /workgroupBarrier|halfTile|subgroup_size/)
  const pinned = text({ lanes: 16, pinned: true })
  assert.match(pinned, /enable subgroup_size_control;/)
  assert.match(pinned, /@compute @workgroup_size\(16\) @subgroup_size\(16\)/)
  // No half-size image: no gathering at all.
  assert.doesNotMatch(taaResolveShader(), /halfTile|halfOut|workgroupBarrier|subgroup/)
})

// The shading rejection's network shuffles across a subgroup of the tile's width and keeps only each
// subgroup's first and last rows in workgroup memory; any other subgroup runs the plain network.
test('the shading rejection runs as a wave only where the subgroup is the tile’s width', () => {
  const text = (wave?: Wave) =>
    rejectShadingShader('rgba8unorm', 'rgba16float', false, 'buffer', 'buffer', wave)
  const plain = text()
  assert.doesNotMatch(plain, /subgroup/)
  assert.equal(text({ lanes: 16, pinned: true }), plain, 'a subgroup of another size')
  const wave = text({ lanes: 32, pinned: false })
  assert.match(wave, /enable subgroups;/)
  assert.match(wave, /subgroupShuffle\(/)
  assert.match(wave, /@builtin\(subgroup_invocation_id\) inSubgroup:u32/)
  assert.doesNotMatch(wave, /@subgroup_size|subgroup_size_control/)
  assert.match(text({ lanes: 32, pinned: true }), /@workgroup_size\(256\) @subgroup_size\(32\)/)
})

// A setting that changes the execution compiles its programs off the frame: the frames are drawn
// with the programs of the execution the pass was made with meanwhile, never a pipeline compiled on
// the frame.
test('another execution compiles off the frame, the pass’s own serving meanwhile', async () => {
  const { device, computePasses } = fakeDevice({ features: ['subgroups'] })
  grantSubgroups(device)
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  temporal.resize(taaShape(8, 4, 'high'), 8, 4)
  await new Promise((done) => setTimeout(done))
  const plain = taaExecutionOf(device, false, 0)
  const modules = () => resolveLabelsOf(computePasses)
  const encoder = device.createCommandEncoder()
  temporal.encode(encoder, taaInputs(), [8, 4], taaSlices(), false, undefined, true, plain)
  assert.deepEqual(modules(), ['TAA_UPDATE false true wave 32'], 'the base serves')
  await new Promise((done) => setImmediate(done))
  temporal.encode(encoder, taaInputs(), [8, 4], taaSlices(), false, undefined, true, plain)
  assert.deepEqual(modules().slice(1), ['TAA_UPDATE false true plain'])
  temporal.dispose()
})

// The anti-aliaser has a 16-bit variant, the one the execution asks for where the device grants
// 16-bit shader floats (§ 25.11 of the specification) and the setting allows.
test('the 16-bit variants run where the device grants shader floats of 16 bits and the setting allows', async () => {
  const device = (...features: string[]) => featuresDevice(features)
  assert.equal(taaExecutionOf(device(), true, 0, true).half, false, 'no 16-bit floats')
  assert.equal(taaExecutionOf(device('shader-f16'), true, 0, true).half, true)
  assert.equal(taaExecutionOf(device('shader-f16'), true, 0, false).half, false, 'switched off')
  const [on, off] = [true, false].map((half) => taaExecutionOf(device('shader-f16'), true, 0, half))
  // The history update has its 16-bit program too, so the two executions run different programs
  // that gather over a tile (the wave variant's own name is gone with it).
  assert.notEqual(on.key, off.key)
  const full = spatialAntiAliasingShader('rg8uint'),
    half = spatialAntiAliasingShader('rg8uint', true)
  assert.doesNotMatch(full, /f16|Half/)
  assert.match(half, /^enable f16;/)
  assert.match(half, /fn findBrowsingH\(c:f16,/)
  // The luma is read through `lumaOf` whichever its form; the default form is the buffer's.
  assert.match(half, /fn aaLoad\(p:vec2i,offset:vec2i\)->f16\{return f16\(lumaOf\(/)
  // The position and the offset stay in 32 bits; the 16-bit luma is the program's alone.
  assert.match(half, /fn aaEncode\(offset:vec2f\)->u32/)
  const { device: kit, computePasses } = fakeDevice({ features: ['shader-f16'] })
  const velocity = createVelocity(kit)
  const temporal = await createTemporalAntialiasing(kit, velocity)
  temporal.resize(taaShape(8, 4, 'high'), 8, 4)
  const dispatched = (run: ReturnType<typeof taaExecutionOf>) => {
    computePasses.length = 0
    const encoder = kit.createCommandEncoder()
    temporal.encode(encoder, taaInputs(), [8, 4], taaSlices(), false, undefined, true, run)
    return computePasses.flatMap(({ commands }) =>
      commandArgs(commands, 'setPipeline')
        .map(([pipeline]) => (pipeline as { module: { label: string } }).module.label)
        .filter((label) => /^TAA_(REJECT_SHADING|SPATIAL_AA|UPDATE)/.test(label)),
    )
  }
  // The shading rejection, the anti-aliaser and the history update run in 16 bits too where
  // granted; the 32-bit update, of another execution, compiles off the frame while the pass's own
  // serves.
  assert.deepEqual(dispatched(taaExecutionOf(kit, true, 0, true)), [
    'TAA_REJECT_SHADING_F16',
    'TAA_SPATIAL_AA_F16',
    'TAA_UPDATE false true plain f16',
  ])
  assert.deepEqual(dispatched(taaExecutionOf(kit, true, 0, false)), [
    'TAA_REJECT_SHADING',
    'TAA_SPATIAL_AA',
    'TAA_UPDATE false true plain f16',
  ])
  temporal.dispose()
})
