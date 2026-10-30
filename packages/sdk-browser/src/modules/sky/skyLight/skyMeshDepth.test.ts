// The sky meshes' depth in the capture: the fog over a face lays itself at the distance of the mesh drawn in each pixel when the
// face keeps their depth, along an endless ray when it does not, and the cube copies the depth with the image it belongs to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_AIR_SHAPE } from '../../../lighting/atmosphere/shape.ts'
import { fogFaceProgram } from './faceWgsl.ts'
import { SKY_MESH_CODE, SKY_MESH_DEPTH_ENTRY, SKY_MESH_ENTRY } from './skyMeshWgsl.ts'
import { createSkyMeshes } from './skyMeshes.ts'
import { CUBE_FACES } from './layout.ts'
import { gatedDevice } from '../../../lighting/deferred/gatedDevice.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createFogStandIns } from '../../../lighting/fog/read.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { createSkyLightTargets } from './targets.ts'
import { createFaceDrawer, skyCompiled } from './captureFaces.ts'
import { BLOCK_STRIDE } from './layout.ts'
import type { SkyLightInputs } from './captureInputs.ts'

test('the fog over a face with the meshes depth ends at the mesh; without it, it is endless', () => {
  const plain = fogFaceProgram(DEFAULT_AIR_SHAPE).code
  const deep = fogFaceProgram(DEFAULT_AIR_SHAPE, true).code
  assert.ok(plain.includes('fogBeyond(dir,face.eye.xyz)'))
  assert.ok(!plain.includes('meshDepth'), 'the plain program reads no depth')
  assert.ok(deep.includes('fogBeyondAlong(dir*meshReach(pixel),face.eye.xyz'))
  assert.ok(deep.includes('@group(1) @binding(1) var meshDepth:texture_2d<f32>'))
  // A pixel no mesh was drawn in keeps the depth buffer's far, zero, and is fogged along the endless ray.
  assert.ok(deep.includes('if(z<=0.0){return FOG_FAR_DEPTH;}'))
  // The distance is the view depth (near over the reversed depth) along the ray of the pixel, not along the face's axis.
  assert.ok(deep.includes('face.eye.w/z*length(faceDirection('))
})

test('the cube copies the image and the depth of a camera with the same orientation', () => {
  assert.ok(SKY_MESH_CODE.includes(`fn ${SKY_MESH_ENTRY}`))
  assert.ok(SKY_MESH_CODE.includes(`fn ${SKY_MESH_DEPTH_ENTRY}`))
  assert.ok(SKY_MESH_CODE.includes('var depthImage:texture_depth_2d'))
  const flips = SKY_MESH_CODE.match(/select\(uv\.x,1\.0-uv\.x,mesh\.scale\.z>0\.5\)/g) ?? []
  assert.equal(flips.length, 2, 'the image and the depth are both turned by the same rule')
})

const lit = {} as GPUTextureView,
  depthImage = {} as GPUTextureView

/** A cube of 16 texels a side on a recording device, its programs compiled. */
async function armed(depthBuffer: boolean) {
  const gpu = gatedDevice()
  const meshes = createSkyMeshes(gpu.device, 16, depthBuffer)
  const encoder = gpu.device.createCommandEncoder()
  const copyIn = (face: number, depth?: GPUTextureView) =>
    meshes.copyIn(encoder, face, lit, [16, 16], [16, 16], depth)
  copyIn(0, depthImage)
  await gpu.land()
  return { ...gpu, meshes, copyIn }
}

test('with the depth buffer the cube keeps a depth layer a face, and a face is held once its image and its depth are', async () => {
  const { meshes, copyIn } = await armed(true)
  assert.equal(meshes.depthBuffer, true)
  for (let face = 0; face < CUBE_FACES; face++) assert.ok(meshes.depthLayer(face), `layer ${face}`)
  for (let face = 0; face < CUBE_FACES; face++) copyIn(face)
  assert.equal(meshes.ready, false, 'the image alone does not hold a face when its depth is asked')
  for (let face = 0; face < CUBE_FACES; face++) copyIn(face, depthImage)
  assert.equal(meshes.ready, true)
})

test('without it the cube keeps no depth and a face is held by its image alone', async () => {
  const { meshes, copyIn } = await armed(false)
  assert.equal(meshes.depthBuffer, false)
  assert.equal(meshes.depthLayer(0), undefined)
  for (let face = 0; face < CUBE_FACES; face++) copyIn(face)
  assert.equal(meshes.ready, true)
})

/** The six faces of a capture that shows ready sky meshes, drawn with the fog shown: the draws it made. */
async function fogged(depthBuffer: boolean, atmosphere = true) {
  const kit = fakeDevice({ asyncPipelines: true })
  const { device } = kit
  const made = createSkyLightPipelines(device, () => {}, DEFAULT_AIR_SHAPE)
  await Promise.all(Object.values(made.pipelines).map((p) => p.prepare()))
  await made.fogDepth.ask().prepare()
  const t = createSkyLightTargets(device, made, 8, 4)
  const meshes = createSkyMeshes(device, 8, depthBuffer)
  const encoder = device.createCommandEncoder()
  for (let face = 0; face < CUBE_FACES; face++)
    meshes.copyIn(encoder, face, lit, [8, 8], [8, 8], depthBuffer ? depthImage : undefined)
  await Promise.all([...Array(3)].map(() => new Promise((done) => setImmediate(done))))
  for (let face = 0; face < CUBE_FACES; face++)
    meshes.copyIn(encoder, face, lit, [8, 8], [8, 8], depthBuffer ? depthImage : undefined)
  assert.equal(meshes.ready, true)
  const view = device
    .createTexture({
      size: { width: 4, height: 4 },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView()
  const input = {
    part: {
      light: {
        lowerHemisphereIsSolidColor: false,
        lowerHemisphereColor: [0, 0, 0],
        lowerHemisphereCoverage: 1,
      },
      quality: { skyLightAlwaysClear: false, skyLightShadowFromOpaque: false },
    },
    atmosphere,
    fog: createFogStandIns(device).read,
    fogShown: true,
    skyMeshes: meshes,
    preExposure: 1,
    frame: 0,
    position: [0, 0, 0],
    air: {
      resolved: { planetRadius: 6360, groundHeight: 0, groundPosition: [0, 0] },
      buffer: device.createBuffer({ size: BLOCK_STRIDE, usage: GPUBufferUsage.STORAGE }),
      transmittance: view,
      multiScatter: view,
      sampler: device.createSampler(),
    },
  } as unknown as SkyLightInputs
  kit.draws.length = 0
  createFaceDrawer(device, made).draw(device.createCommandEncoder(), t, 0, 6, true, false, input)
  return { draws: kit.draws.filter((draw) => draw.fragment === 'fogFaceMain'), made, meshes }
}

test('over the meshes with their depth the fog is drawn by the program that reads it, with the face block and the depth of its face', async () => {
  const { draws, made } = await fogged(true)
  assert.equal(draws.length, CUBE_FACES)
  for (const draw of draws) {
    assert.equal(draw.pipeline, made.fogDepth.ask().get(), 'the depth program')
    const [, block] = draw.groups as { entries: { binding: number }[] }[]
    assert.deepEqual(
      block.entries.map((entry) => entry.binding),
      [0, 1],
      'the face block and the depth',
    )
  }
})

test('over the meshes without their depth the fog is the endless one, on the face block alone', async () => {
  const { draws, made } = await fogged(false)
  assert.equal(draws.length, CUBE_FACES)
  for (const draw of draws) {
    assert.equal(draw.pipeline, made.pipelines.fog.get(), 'the plain program')
    assert.equal((draw.groups[1] as { entries: unknown[] }).entries.length, 1)
  }
})

test('the capture waits for the fog program that reads the depth, and for it alone when the depth is kept', async () => {
  const { device } = fakeDevice({ asyncPipelines: true })
  const made = createSkyLightPipelines(device, () => {}, DEFAULT_AIR_SHAPE)
  await Promise.all(Object.values(made.pipelines).map((p) => p.prepare()))
  const input = (depthBuffer?: boolean, fogShown = true) =>
    ({
      part: { quality: { skyLightShadowFromOpaque: false } },
      skyMeshes: depthBuffer === undefined ? undefined : { depthBuffer, ready: true },
      fog: {},
      fogShown,
    }) as unknown as SkyLightInputs
  assert.equal(skyCompiled(made, input()), true, 'no meshes')
  assert.equal(skyCompiled(made, input(false)), true, 'no depth kept')
  assert.equal(
    skyCompiled(made, input(true, false)),
    true,
    'no fog shown: the program is not waited for',
  )
  assert.equal(skyCompiled(made, input(true)), false, 'asked, still compiling')
  await made.fogDepth.ask().prepare()
  assert.equal(skyCompiled(made, input(true)), true)
})

test('the fog is laid over the meshes of a scene with no atmosphere too, from the stand-in air', async () => {
  const { draws } = await fogged(true, false)
  assert.equal(draws.length, CUBE_FACES)
})
