// The air's groups and draws bind the clouds' sky occlusion map where their programs read the clouds'
// shade: the groups made over a light buffer and its shadow maps, the sky's draw, the haze marched on the
// opaque surfaces, and the bindings every program declares against those of its layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { cloudHazeProgram } from '../../modules/sky/clouds/traceHazeProgram.ts'
import { skyFaceProgram } from '../../modules/sky/skyLight/faceWgsl.ts'
import { AIR_BINDING } from './binding.ts'
import { airGroupsOver, sameCloudShadow } from './bindings.ts'
import { cloudShadowStandIn } from './cloudShadowStandIn.ts'
import { createOpaqueHazeDraw } from './opaqueHaze.ts'
import { airLayoutEntries } from './programs.ts'
import { opaqueHazeProgram } from './opaqueHazeWgsl.ts'
import { createAirResources } from './resources.ts'
import { airProgramsOf } from './airPrograms.fixture.ts'
import { DEFAULT_AIR_SHAPE } from './shape.ts'
import { createSkyDraw } from './sky.ts'
import { skyProgram } from './skyWgsl.ts'

/** The buffers a light buffer's passes bind over the kit's device: the usages, and the shadow maps' five. */
function airBuffers(device: GPUDevice) {
  const buffer = (usage: number) => device.createBuffer({ size: 1 << 16, usage })
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const maps = {
    pageTable: buffer(STORAGE),
    projectionData: buffer(STORAGE),
    uniforms: buffer(UNIFORM),
    pool: buffer(STORAGE),
    view: buffer(UNIFORM),
  }
  return { buffer, STORAGE, maps }
}

test('every group of the air’s passes that reads the clouds’ shade binds the sky occlusion map', () => {
  const { device, bindGroups } = fakeDevice()
  const resources = createAirResources(device, DEFAULT_AIR_SHAPE, () => {})
  const { buffer, STORAGE, maps } = airBuffers(device)
  const stand = cloudShadowStandIn(device)
  const ao = device
    .createTexture({
      size: { width: 4, height: 4 },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView()
  const shade = { ...stand, ao }
  const over = airGroupsOver(resources, buffer(STORAGE), maps, shade)
  // The two groups made when first read.
  void over.separate
  void over.capture360
  const reading = (bindGroups as unknown as GPUBindGroupDescriptor[]).filter((group) =>
    [...group.entries].some((e) => e.binding === AIR_BINDING.cloudShadow),
  )
  // The sky table, the haze, the haze kept apart, the haze around the capture.
  assert.equal(reading.length, 4)
  for (const group of reading) {
    const bound = [...group.entries].find((e) => e.binding === AIR_BINDING.cloudSkyAO)
    assert.equal(bound?.resource, ao)
  }
  assert.ok(!sameCloudShadow(stand, shade), 'another sky occlusion map is another set')
  assert.ok(sameCloudShadow(shade, { ...shade }))
})

test('the sky’s draw and the haze marched on the opaque surfaces bind the sky occlusion map too', async () => {
  const { device, bindGroups } = fakeDevice()
  // A marched sky (no table) and a haze marched on the opaque surfaces: the two draws that read the clouds' shade.
  const shape = {
    ...DEFAULT_AIR_SHAPE,
    skyView: { ...DEFAULT_AIR_SHAPE.skyView, fast: false },
    aerial: { ...DEFAULT_AIR_SHAPE.aerial, fastOnOpaque: false },
  }
  const resources = createAirResources(device, shape, () => {})
  const { buffer, STORAGE, maps } = airBuffers(device)
  const view = (format: GPUTextureFormat, usage: number, dimension: GPUTextureDimension = '2d') =>
    device
      .createTexture({
        size: { width: 4, height: 4, depthOrArrayLayers: 1 },
        format,
        usage,
        dimension,
      })
      .createView()
  const ao = view('rgba16float', GPUTextureUsage.TEXTURE_BINDING)
  const over = airGroupsOver(resources, buffer(STORAGE), maps, {
    ...cloudShadowStandIn(device),
    ao,
  })
  const draw = createSkyDraw(resources, () => over)
  const opaque = createOpaqueHazeDraw(
    device,
    resources,
    () => over,
    () => {},
  )!
  await resources.skyPipeline.prepare()
  await new Promise((done) => setImmediate(done))
  const sampled = GPUTextureUsage.TEXTURE_BINDING
  const hdr = view('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | sampled)
  const flags = view('rg32uint', sampled)
  const depth = view('depth32float', sampled)
  const noise = view('rgba16float', sampled)
  const encoder = device.createCommandEncoder()
  draw(encoder, hdr, flags, 4, 4, noise)
  assert.ok(opaque.ready, 'the haze’s pipeline is compiled')
  opaque.draw(encoder, hdr, flags, depth, 4, 4, noise)
  const groupWith = (binding: number) =>
    (bindGroups as unknown as GPUBindGroupDescriptor[]).filter((group) =>
      [...group.entries].some((e) => e.binding === binding),
    )
  // The sky's group is the one with the sky table, the haze's the one with the depth.
  for (const marker of [AIR_BINDING.skyView, AIR_BINDING.depth]) {
    const [made] = groupWith(marker).filter((g) =>
      [...g.entries].some((e) => e.binding === AIR_BINDING.cloudShadow),
    )
    assert.equal(
      [...made.entries].find((e) => e.binding === AIR_BINDING.cloudSkyAO)?.resource,
      ao,
      `the draw with binding ${marker}`,
    )
  }
})

test('the bindings an air program declares are those of its layout, the sky occlusion map’s and the light shafts’ mask among them', () => {
  const FRAGMENT_AND_COMPUTE = 6
  for (const fast of [true, false]) {
    const shape = {
      ...DEFAULT_AIR_SHAPE,
      skyView: { ...DEFAULT_AIR_SHAPE.skyView, fast },
      aerial: { ...DEFAULT_AIR_SHAPE.aerial, fastOnOpaque: false },
    }
    const programs = {
      ...airProgramsOf(shape),
      sky: skyProgram(shape),
      opaqueHaze: opaqueHazeProgram(shape),
      cloudHaze: cloudHazeProgram(shape),
      skyFace: skyFaceProgram(shape),
      skyFaceShadowed: skyFaceProgram(shape, true),
    }
    for (const [name, program] of Object.entries(programs)) {
      const declared = [...program.code.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((m) =>
        Number(m[1]),
      )
      const laid = airLayoutEntries(program.bindings, FRAGMENT_AND_COMPUTE, shape).map(
        (e) => e.binding,
      )
      assert.deepEqual(
        [...declared].sort((a, b) => a - b),
        [...laid].sort((a, b) => a - b),
        `${name}, sky table ${fast}`,
      )
    }
  }
})
