// The clouds on the translucent surfaces, per vertex: the blend programs of a scene that holds a
// surface whose material has `cloudFog`, or of a session whose project switch reads the clouds' shade,
// read both at each vertex (the cloud image and the shade) and hand them over as two extras of the
// vertex stage's output; every other program holds none of that code, and no program spends a
// varying more than its extras, or a fragment binding, on it (the fragment stage's sampled textures
// and storage buffers are all spent).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { FULL_CONTRACT } from '../lighting/deferred/contractCuts.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'
import { stageBindingCounts } from '../../../../tests/kit/fakeDevice/limitRules.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../gpu/core/wgslNames.fixture.ts'
import { CLOUD_FOG_MODEL_BIT, MODEL_SHIFT } from '../materials/surface/surfaceModelWord.ts'
import { cloudFogStandIn } from '../modules/sky/clouds/cloudFogStandIn.ts'
import { CLOUD_FOG_BLOCK } from '../modules/sky/clouds/translucentRead.ts'
import type { CloudShown } from '../modules/sky/clouds/viewTargets.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { translucentCloudVertex } from './cloudVertex.ts'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import { blendShader } from './shader.ts'
import type { BlendGpuItem } from './state.ts'
import { transmitWgsl } from './transmission/transmitWgsl.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'

/** The code that reads the cloud image and lays its layer: none of it is in a program without. */
const CLOUD_FOG_CODE = ['cloudFogOver', 'cloudFogLayer', 'cloudFogged', 'cloudFogColour']

const plain = blendShader({}, { stage: transmitWgsl({}, false) })
const read = blendShader(
  {},
  {
    stage: transmitWgsl({}, false, undefined, { clouds: true, fog: true }),
    reads: { clouds: true, fog: true },
  },
)

/** The locations the vertex struct of `code` declares. */
const locationsOf = (code: string) =>
  /struct VSOut\{([^}]*)\}/.exec(code)![1].match(/@location\(\d+\)/g)

test('a program that reads no cloud per vertex holds none of the code', () => {
  for (const code of [
    plain,
    blendShader({}),
    wgslModule(blendVertexWgsl(true)),
    wgslModule(blendVertexWgsl(false)),
  ])
    for (const text of CLOUD_FOG_CODE)
      assert.ok(!code.includes(text), `${text} is not in the module without the clouds’ fog`)
  assert.match(plain, /bary:vec3f/)
})

test('the vertex stage reads the cloud image and hands the layer over in an extra of its own, the thin colour’s lanes left alone', () => {
  assert.match(
    read,
    /fogLayer=fogStack\(cloudFogOver\(out\.position,out\.view,uni\.eye\.xyz\),fogLayer\);/,
  )
  // Its light and its transmittance in the first extra's four lanes.
  // The fog the vertex works out lies under it where the material's fog is per vertex (`fogLaidFar`).
  assert.match(
    read,
    /fogLayer=fogStack\(fogLocalVertex\(out\.view,uni\.eye\.xyz\),fogLaidFar\(out\.view,uni\.eye\.xyz,true\)\);/,
  )
  assert.match(read, /out\.extras0=fogLayer;/)
  assert.match(read, /fn cloudFogLayer\(v:VSOut\)->vec4f\{return v\.extras0;\}/)
  // The barycentrics are the corner's, and the thin subsurface colour keeps its lanes.
  assert.match(read, /out\.bary=cornerBarycentric\(local%3u\);/)
  assert.match(
    read,
    /out\.normal\.w=m\.subsurface\.x;out\.tangent\.w=m\.subsurface\.y;out\.bitangent\.w=m\.subsurface\.z;/,
  )
  assert.match(read, /bary:vec3f/)
  assert.equal(locationsOf(read)!.length, 15, 'fifteen, and the front face: the sixteen')
  assert.equal(locationsOf(plain)!.length, 13, 'no fog per vertex, no clouds: no extra')
})

test('the fragment stage lays the layer over the fog of the surfaces that wear the bit, and reads the thin colour in its lanes', () => {
  const bit = CLOUD_FOG_MODEL_BIT << MODEL_SHIFT
  assert.match(
    read,
    new RegExp(
      `rgb=rgb\\*fog\\.a\\+fog\\.rgb\\*inscatterShare\\(alpha\\);\\s*\\}\\s*if\\(\\(flags&${bit}u\\)!=0u&&!fogVertexed\\(in\\)\\)\\{rgb=cloudFogged\\(rgb,in\\);\\}`,
    ),
  )
  assert.match(
    read,
    /fn cloudFogged\(rgb:vec3f,v:VSOut\)->vec3f\{\s*let layer=cloudFogLayer\(v\);\s*return rgb\*layer\.a\+layer\.rgb;/,
  )
  // The thin colour is read in its lanes with or without the cloud layer: no record read for it.
  for (const code of [plain, read])
    assert.match(code, /var thin=clamp\(vec3f\(in\.normal\.w,in\.tangent\.w,in\.bitangent\.w\),/)
  assert.ok(!/var thin=clamp\(materialAt/.test(read))
  // The transmissive stages lay it over their fog the same way.
  assert.match(
    read,
    new RegExp(
      `if\\(!fogFree&&\\(flags&${bit}u\\)!=0u&&!fogVertexed\\(in\\)\\)\\{fog=fogStack\\(cloudFogLayer\\(in\\),fog\\);\\}`,
    ),
  )
})

test('the program that reads the clouds names what it uses, declares nothing twice and is balanced', () => {
  assert.deepEqual(unresolvedNames(read), [])
  assert.deepEqual(reservedNames(read), [])
  assert.equal(unbalanced(read), '')
  assert.equal(read.match(/fn cloudFogOver\(/g)!.length, 1)
})

/** The blend programs of one translucent item wearing a material with or without the clouds in its
 *  fog: their pipeline layouts and the pipelines' flag. */
async function built(cloudFog: boolean, cloudShade = false) {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  const surface = G.basicSurface()
  Object.assign(surface, { blending: 'normal', cloudFog })
  const items = [{ surface: surfaceOf(surface), transmissive: false }] as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: assert.ifError }
  const made = await createWebgpuBlendPipelines(device, items, undefined, true, undefined, false, {
    lit,
    cloudShade,
  })
  const worst: Record<string, number> = {}
  for (const layout of layouts)
    for (const { kind, count } of stageBindingCounts(layout))
      worst[kind] = Math.max(worst[kind] ?? 0, count)
  return { reads: made.blendPipelines.reads?.clouds, worst }
}

test('a scene with such a surface, or a session whose switch reads the shade, builds the programs that read the clouds, and the fragment stage binds no more', async () => {
  const [without, wearing, shaded] = [
    await built(false),
    await built(true),
    await built(false, true),
  ]
  assert.equal(without.reads, false)
  assert.equal(wearing.reads, true)
  assert.equal(shaded.reads, true, 'the one flag: either feature reads both')
  assert.deepEqual(shaded.worst, without.worst, 'one layout')
  const fragment = Object.keys(wearing.worst).filter((kind) => kind.endsWith('Fragment'))
  assert.ok(fragment.length > 0)
  assert.deepEqual(
    fragment.map((kind) => wearing.worst[kind]),
    fragment.map((kind) => without.worst[kind]),
    'the same sampled textures, storage buffers and samplers in the fragment stage',
  )
  // The fragment stage's real headroom under the sixteen sampled textures WebGPU guarantees a stage: the
  // forward reflection group is the smaller one (`reflectionForwardLayout`), so the worst fragment layout
  // holds 14 and the cloud's colour and depth (two more) would leave none spare. The image is still read per
  // vertex, which keeps the fragment layout the same with or without it; a layout that grows past this
  // headroom fails here before it fails on a device.
  const sampled = without.worst['sampled textures in the Fragment']
  assert.equal(sampled, 14)
  assert.ok(sampled + 2 <= 16)
  // The vertex stage binds them: two sampled textures, a sampler and a uniform buffer.
  assert.ok(wearing.worst['sampled textures in the Vertex'] <= 16)
})

/** A runtime that holds the pipelines of a scene that reads the clouds per vertex (`reads`), the image
 *  `shown` its clouds left, at the image `frame`, on a device that counts what it makes and writes. */
function runtimeOf(reads: boolean, shown: CloudShown | undefined, frame: number) {
  installGpuGlobals()
  const writes: Float32Array[] = []
  const made = { buffers: 0 }
  const device = {
    createBuffer: () => (made.buffers++, {}),
    createTexture: () => ({ createView: () => ({}) }),
    createSampler: () => ({}),
    queue: {
      writeBuffer: (_b: unknown, _o: number, data: Float32Array) => writes.push(data.slice()),
    },
  } as unknown as GPUDevice
  const rt = {
    vis: { blendPipelines: { reads: { clouds: reads, fog: false } } },
    gpu: { clouds: { shown } },
    run: { frame },
    blendState: { cloudShade: false },
  } as unknown as WebgpuPagesRuntime
  return { rt, device, writes, made }
}

const SHOWN = {
  colour: {} as GPUTextureView,
  depth: {} as GPUTextureView,
  uvScale: [0.5, 0.5],
  uvMax: [0.49, 0.49],
  preExposure: 2,
  softBlendingKm: 0.5,
  frame: 7,
} as unknown as CloudShown

test('the cloud image of this image is what the translucent programs read; the stand-in clears the layer otherwise', () => {
  const { at } = CLOUD_FOG_BLOCK
  // A program that reads the clouds, the clouds drawn for this image: the image and the block that reads it.
  const reading = runtimeOf(true, SHOWN, 7)
  const standIn = cloudFogStandIn(reading.device)
  const fogWrites = () =>
    reading.writes.filter((words) => words.length === CLOUD_FOG_BLOCK.words).length
  const set = translucentCloudVertex(reading.rt, reading.device).fog
  assert.equal(set.colour, SHOWN.colour)
  assert.equal(set.depth, SHOWN.depth)
  assert.equal(fogWrites(), 1)
  assert.equal(reading.writes.at(-1)![at.soft + 2], 1, 'an image is bound')
  assert.equal(translucentCloudVertex(reading.rt, reading.device).fog, set, 'made once an image')
  assert.equal(fogWrites(), 1)
  // The clouds of the last image only: another image, none drawn for it, the stand-in, whose block says none.
  const stale = runtimeOf(true, SHOWN, 8)
  const none = translucentCloudVertex(stale.rt, stale.device).fog
  assert.equal(none, cloudFogStandIn(stale.device))
  assert.notEqual(none.colour, SHOWN.colour)
  assert.equal(
    stale.writes.some((words) => words.length === CLOUD_FOG_BLOCK.words),
    false,
    'the stand-in’s block is zeros as made: no write',
  )
  assert.notEqual(standIn, none, 'one stand-in a device')
})

test('programs that read no cloud are given the stand-ins of the device: no write, no buffer of the runtime’s own', () => {
  const idle = runtimeOf(false, SHOWN, 7)
  const set = translucentCloudVertex(idle.rt, idle.device)
  assert.notEqual(set.fog.colour, SHOWN.colour)
  assert.equal(set, translucentCloudVertex(idle.rt, idle.device), 'the same set every image')
  const buffers = idle.made.buffers
  idle.rt.run.frame++
  translucentCloudVertex(idle.rt, idle.device)
  assert.equal(idle.made.buffers, buffers, 'nothing more is made')
  assert.equal(
    idle.writes.some((words) => words.length === CLOUD_FOG_BLOCK.words),
    false,
  )
})
