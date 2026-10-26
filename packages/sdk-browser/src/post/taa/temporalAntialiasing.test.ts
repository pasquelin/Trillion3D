import test from 'node:test'
import assert from 'node:assert/strict'
import { VELOCITY_INPUT_BINDINGS as AT } from './nearestSurfaceWgsl.ts'
import { taaInputs, taaShape, taaSlices } from './frame.fixture.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { TAA_BINDINGS } from './bindingsWgsl.ts'

// Each history carries its colour and, beside it, its metadata — the history's validity alone,
// since the as-is pixels are composed after the temporal pass (it held the as-is share beside the
// validity, and the resolve wrote an output share) —: the update
// dispatches over the history and stores both targets, and the bytes it declares count them with
// the analysis's targets and render-resolution histories.
test('each history is a colour and its validity, stored together and counted', async () => {
  const { device, textures, renderPipelines, computePipelines } = fakeDevice()
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  assert.deepEqual(renderPipelines, [], 'the pass draws nothing: its programs are all dispatches')
  assert.deepEqual(
    computePipelines
      .filter(({ compute }) => compute.entryPoint === 'resolve')
      .map(({ layout }) =>
        [
          ...(layout as unknown as { bindGroupLayouts: GPUBindGroupLayoutDescriptor[] })
            .bindGroupLayouts[0].entries,
        ]
          .filter((entry) => entry.storageTexture)
          .map((entry) => [entry.binding, entry.storageTexture!.format]),
      ),
    [
      [
        [TAA_BINDINGS.historyOut, 'rgba16float'],
        [TAA_BINDINGS.validityOut, 'rgba8unorm'],
        [TAA_BINDINGS.halfOut, 'rgba16float'],
      ],
    ],
    'the one update stores the colour, the validity and the half-size image',
  )
  temporal.resize(taaShape(8, 4), 8, 4)
  // First the 1×1 zero a frame without responsiveness reads and the 1×1 of no translucency, then the four frames of the history
  // — at twice the display's size, a colour and its validity each: two for good, two rolling —
  // and the half-size image, the resolve's image at the display's size, then the analysis's targets —
  // the closest depth, the reprojection word, the velocity marks, the reprojected flicker history,
  // the rejection —, the reprojected shading histories (the last image's frame's and the resurrected
  // frame's layers), the reprojection field (the vector's and the jacobian's layers), the shading
  // history of each frame, the field's boundary, the flicker and thin geometry histories, and the
  // anti-aliaser's output. Since the shading rejection runs in one workgroup network, the held
  // measure's three half-float targets, the two rejections before the merge, the gate and the
  // analysis views' words are gone, the textures one pass writes together are layers of one
  // texture, and the scene colour and the LDR luma are buffers (no texture listed here).
  assert.deepEqual(
    textures.map(({ label, format, width, height }) => [
      label!.replace('Trillion3D TAA ', ''),
      format,
      width,
      height,
    ]),
    [
      ['no responsiveness', 'r8unorm', 1, 1],
      ['Trillion3D no translucency', 'rgba16float', 1, 1],
      ...[0, 1, 2, 3].flatMap((frame) => [
        [`history ${frame}`, 'rgba16float', 16, 8],
        [`validity ${frame}`, 'rgba8unorm', 16, 8],
      ]),
      ['output half', 'rgba16float', 4, 2],
      ['output', 'rgba16float', 8, 4],
      ['closest', 'r32uint', 8, 4],
      ['reprojected', 'r32uint', 8, 4],
      ['marks', 'rgba8uint', 8, 4],
      ['moireReprojected', 'rgba8unorm', 8, 4],
      ['rejection', 'rgba8unorm', 8, 4],
      ['guidesReprojected', 'rgba8unorm', 8, 4],
      ['field', 'r32uint', 8, 4],
      // The measures before the translucency and the thin geometry's outputs, four layers of eight
      // bits (four bytes on the core's formats), since the flicker luma and the coverage are measured
      // apart and the weight relaxation is a pass of its own.
      ['measures', 'rgba8unorm', 8, 4],
      ...[0, 1, 2, 3].map((frame) => [`shading history ${frame}`, 'rgba8unorm', 8, 4]),
      ['boundary', 'r32uint', 8, 4],
      ['moire history', 'rgba8unorm', 8, 4],
      ['thin geometry', 'rgba8uint', 8, 4],
      // The anti-aliaser's offsets, stored by its dispatch.
      ['spatial anti-aliasing', 'rgba8uint', 8, 4],
    ],
  )
  // The vectors the reprojection starts from are the velocity stage's, which the motion blur reads
  // after the pass: the analysis keeps none, nor a target for the flicker error, which stays in the
  // shading rejection's workgroup; the hole-filled vectors are the field's first layer.
  const named = (name: string) =>
    textures.filter(({ label }) => label === `Trillion3D TAA ${name}`).length
  assert.deepEqual(['vectors', 'flickerError', 'closest', 'field'].map(named), [0, 0, 1, 1])
  // The four frames of the history at 16 × 8 (a half-float colour and the validity's four bytes on
  // the core's formats), the half-size image, the resolved image (its colour), then the analysis at
  // 8 × 4: five
  // words of targets, the scene colour (two words of half floats without the packed formats) and the
  // LDR luma's byte, the anti-aliaser's four bytes, two layers each of the reprojected shading
  // histories and the field, the flicker and thin geometry histories, a shading history word for
  // each of the four frames, the field's boundary, a perspective's occluder word and the word of the
  // rejection's mask the anti-aliaser reads.
  assert.equal(
    temporal.historyBytes,
    4 * 16 * 8 * (8 + 4) +
      4 * 2 * 8 +
      8 * 4 * 8 +
      8 * 4 * (5 * 4 + 4 * 4 + 8 + 1 + 4 + 2 * 4 + 2 * 4 + 4 + 4 + 4 * 4 + 4 + 4 + 4),
  )
  temporal.dispose()
})

test('histories with layers store within the stage limit and release every history with their targets', async () => {
  const { device, textures, destroyed, computePipelines } = fakeDevice()
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  temporal.resize(taaShape(8, 4), 8, 4)
  const view = () => ({}) as GPUTextureView
  const encoder = device.createCommandEncoder()
  const frame = taaInputs()
  temporal.encode(encoder, { ...frame, filter: [view(), view()] }, [8, 4], taaSlices())
  const layered = () =>
    computePipelines.filter(({ compute }) => / true (true|false) /.test(compute.module.label ?? ''))
  while (!layered().length) await new Promise((done) => setImmediate(done))
  // The updates: the layered one stores the colour, the validity and the two layers, at the
  // four storage textures WebGPU guarantees a stage; the one that stores the half-size image too
  // is made only where the device binds a fifth.
  const stores = (pipeline: GPUComputePipelineDescriptor) =>
    [
      ...(pipeline.layout as unknown as { bindGroupLayouts: GPUBindGroupLayoutDescriptor[] })
        .bindGroupLayouts[0].entries,
    ].filter((entry) => entry.storageTexture).length
  const updates = computePipelines.filter(({ compute }) => compute.entryPoint === 'resolve')
  for (const pipeline of updates) assert.ok(stores(pipeline) <= 4, pipeline.compute.module.label)
  assert.deepEqual(
    layered().map(stores),
    [4],
    'the layers on a history that writes no half-size image',
  )
  assert.deepEqual(
    updates
      .map(({ compute }) => compute.module.label)
      .filter((label) => label?.includes(' true true ')),
    [],
    'no update with both the layers and the half-size image: a fifth storage texture',
  )
  const histories = textures.filter(({ label }) => label?.includes('TAA shading history'))
  assert.equal(histories.length, 4, 'a shading history for each of the four frames')
  temporal.release()
  assert.equal(temporal.historyBytes, 0)
  // Retired: this image's commands may still name them; destroyed after its submit.
  assert.ok(histories.every((history) => !destroyed.includes(history)))
  destroyRetired(device)
  for (const history of histories) assert.ok(destroyed.includes(history))
  temporal.dispose()
})

/** The compute pipelines `encoder`'s passes set, by entry point, as the fake device made them. */
function pipelinesSet(encoder: GPUCommandEncoder, entryPoint: string) {
  const seen: Array<{ constants?: Record<string, number> }> = []
  const begin = encoder.beginComputePass.bind(encoder)
  encoder.beginComputePass = (descriptor) => {
    const pass = begin(descriptor)
    const set = pass.setPipeline.bind(pass)
    pass.setPipeline = (pipeline) => {
      if ((pipeline as unknown as { entryPoint: string }).entryPoint === entryPoint)
        seen.push(pipeline as never)
      set(pipeline)
    }
    return pass
  }
  return seen
}

// One module serves the scene with no displaced surface and the one with some: the pipeline that
// solves the flat points (`DISPLACED`) is the image's, never made for a scene that draws none.
test("the velocity stage and the analysis's nearest velocity run the displaced pipeline for an image that draws displaced surfaces", async () => {
  const { device, computePipelines } = fakeDevice()
  const velocity = createVelocity(device)
  const temporal = await createTemporalAntialiasing(device, velocity)
  temporal.resize(taaShape(8, 4), 8, 4)
  velocity.ensure(8, 4)
  const made = (entryPoint: string) =>
    computePipelines.filter(({ compute }) => compute.entryPoint === entryPoint).length
  assert.equal(made('nearestVelocity'), 1, 'the analysis made the flat pipeline only')
  const frame = taaInputs()
  // An image of each kind asks the pipelines it skips; the next ones run them.
  for (const tessellated of [false, true]) {
    velocity.frame.tessellated = tessellated
    const asking = device.createCommandEncoder()
    temporal.encode(asking, { ...frame }, [8, 4], taaSlices())
    velocity.encode(asking, frame, [8, 4], tessellated)
  }
  await pipelinesSettled(device)
  for (const tessellated of [false, true]) {
    velocity.frame.tessellated = tessellated
    const encoder = device.createCommandEncoder()
    const nearest = pipelinesSet(encoder, 'nearestVelocity')
    const own = pipelinesSet(encoder, 'surfaceVelocity')
    temporal.encode(encoder, { ...frame }, [8, 4], taaSlices())
    velocity.encode(encoder, frame, [8, 4], tessellated)
    const constants = tessellated ? { DISPLACED: 1 } : undefined
    assert.deepEqual(
      [nearest, own].map((seen) => seen.map((pipeline) => pipeline.constants)),
      [[constants], [constants]],
      `tessellated ${tessellated}`,
    )
  }
  assert.equal(made('nearestVelocity'), 2)
  assert.equal(made('surfaceVelocity'), 2)
  temporal.dispose()
})

// A resize of the colour texture pool replaces the atlas's lanes' views and its page table in the
// same atlas object, the old pool destroyed once the submit that may read it is done: a group keyed
// on the atlas would bind the destroyed pool at the next submit (a lost device). The analysis's and
// the velocity stage's groups are keyed on the views and the page table they bind.
test('a resize of the colour pool makes the velocity groups again: the old pool is bound no more', async () => {
  const { device, bindGroups } = fakeDevice()
  const velocity = createVelocity(device)
  const temporal = await createTemporalAntialiasing(device, velocity)
  temporal.resize(taaShape(8, 4, 'high'), 8, 4)
  velocity.ensure(8, 4)
  const color = { views: [{}, {}, {}], pages: { buffer: {} } }
  const inputs = taaInputs({ textures: { color } as never })
  const frame = () => {
    const encoder = device.createCommandEncoder()
    temporal.encode(encoder, inputs, [8, 4], taaSlices())
    velocity.encode(encoder, inputs, [8, 4], false)
  }
  /** The resources the groups made since `from` bind at the colour atlas's bindings. */
  const atlasBound = (from: number): unknown[] =>
    bindGroups
      .slice(from)
      .flatMap(({ entries }) =>
        [...entries]
          .filter(({ binding }) => binding >= AT.colorPool0 && binding <= AT.colorPages)
          .map(({ resource }) =>
            'buffer' in (resource as object) ? (resource as GPUBufferBinding).buffer : resource,
          ),
      )
  // Two frames: the groups of each of the two frames the pass's identities hold are made.
  frame()
  frame()
  const made = bindGroups.length
  assert.ok(atlasBound(0).includes(color.views[0]), 'the groups bind the pool')
  frame()
  assert.equal(bindGroups.length, made, 'a frame that moved nothing makes no group')
  const old = [...color.views, color.pages.buffer]
  color.views = [{}, {}, {}]
  color.pages = { buffer: {} }
  frame()
  const after = atlasBound(made)
  assert.ok(after.length > 0, 'the groups that bind the atlas are made again')
  assert.ok(
    old.every((resource) => !after.includes(resource)),
    'none binds the pool retired',
  )
  assert.ok(after.includes(color.views[0]) && after.includes(color.pages.buffer))
  temporal.dispose()
})
