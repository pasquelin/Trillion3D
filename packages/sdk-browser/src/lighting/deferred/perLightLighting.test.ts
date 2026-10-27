// The lit image with the shadowed local lights lit one by one (`shadowOnePassProjection` false): the
// batched local pass leaves them out, and each is drawn in a pass of its own after its mask is made, the indirect
// light drawn first, before every light, in the pass of the batched ones.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { VSM_LIGHT_GRID_WGSL } from '../shadows/vsm/projection/lightGridWgsl.ts'
import { LOCAL_SHADOWED_WGSL } from '../direct/shadowSlice.ts'
import type { PerLightLights } from '../shadows/vsm/projection/perLightPass.ts'
import { FULL_CONTRACT } from './contractCuts.ts'
import { localPassWgsl } from './lightPassWgsl.ts'
import { lobelessLighting } from './recorder.fixture.ts'
import { TILE_CLASS } from './tileClass.ts'
import { litSteps } from './litProgram.ts'
import { perLightPassWgsl } from './perLightPassWgsl.ts'
import { pipelinesSettled } from './compileLedger.ts'
import { SURFACE_COLOUR_PASS } from '../../diagnostic/stage/passLabels.ts'

const KEY = { ...FULL_CONTRACT, lobeless: true, contactless: true }
const CLASS = TILE_CLASS.simple

test('the default local pass knows nothing of the per-light path', () => {
  assert.doesNotMatch(wgslModule(localPassWgsl(KEY, CLASS)), /perLight|PerLight/)
})

test('a shadowed light leaves the batched local loop, an unshadowed one stays', () => {
  const batched = functionsOf(wgslModule(localPassWgsl(KEY, CLASS)), ['localLighting'])
  const module = wgslModule(localPassWgsl(KEY, CLASS, { skipHeld: true }))
  const skip = 'if(isSun(directLights.items[rank])){continue;}'
  // The same loop, one statement longer: a local light of a shadow slot is left to its draw.
  assert.ok(batched.includes(skip))
  assert.equal(
    functionsOf(module, ['localLighting']),
    batched.replace(skip, `${skip}\n  if(lightHasLocalShadow(rank)){continue;}`),
  )
  const held = functionsOf(module, ['lightHasLocalShadow'])
  assert.match(held, /let slice=i32\(directLights\.items\[rank\]\.params\.y\);/)
  assert.match(held, /return slice>=0&&!shadowSliceIsSun\(slice\);/)
  // The pruned grid lists the same lights: the shadowed local lights, by the one test.
  assert.ok(VSM_LIGHT_GRID_WGSL.deps.includes(LOCAL_SHADOWED_WGSL))
  assert.match(VSM_LIGHT_GRID_WGSL.text, /return lightHasLocalShadow\(rank\)&&/)
})

test('the per-light draw lights one light of its record through the batched light term, its shadow its layer of the mask', () => {
  const draw = wgslModule(perLightPassWgsl(KEY, CLASS))
  const main = functionsOf(draw, ['perLightMain', 'perLightLighting'])
  assert.match(
    main,
    /perLightLighting\(albedo,base\.a,normal\.a,N,V,P,screenOcclusionAt\(coord\),perLight\.rank\)/,
  )
  assert.match(main, /declaredLight\(rank,rgb,metal,rough,N,V,P,ao,shading\)/)
  assert.equal(draw.match(/fn declaredLight\(/g)?.length, 1, 'the one light term')
  assert.equal(draw.match(/fn shadowFactor\(/g)?.length, 1, 'the one shadow read of the family')
  // The shadow is the layer's blue channel squared; no lane of a packed mask is read.
  assert.match(
    functionsOf(draw, ['shadowFactor']),
    /let encoded=textureLoad\(vsmPerLightMask,vsmMaskPixel,perLight\.layer,0\)\.z;\n return encoded\*encoded;/,
  )
  assert.doesNotMatch(draw, /vsmLocalFactor|vsmMaskLaneOf|vsmSunMask/)
  assert.match(draw, /var<uniform> perLight:PerLightRecord;/)
})

/** The lit frames of a lobeless lighting, drawn with and without the per-light lights. */
async function frames() {
  const made = await lobelessLighting()
  const { gpu, device, draw } = made
  const records = device.createBuffer({
    size: 512,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  let ready = true
  const perLight: PerLightLights = {
    count: 2,
    records,
    stride: 256,
    strideWords: 64,
    ints: Int32Array.from(
      { length: 128 },
      (_, k) => [0, 0, 8, 8, 8, 8, 16, 16][k < 4 ? k : k - 60] ?? 0,
    ),
    offsets: new Uint32Array([0, 256]),
    mask: {} as GPUTextureView,
    ready: () => ready,
    encodeMask: (_encoder, i) => void gpu.commands.push(`mask ${i}`),
    markStale: () => undefined,
  }
  /** The order of the lit image's passes and the masks between them, the `loadOp` of each pass and the
   *  pipelines it drew with. */
  const frame = (lights?: PerLightLights) => {
    const passes = gpu.passes.length,
      commands = gpu.commands.length
    draw({ lobeless: true, perLight: lights })
    const drawn = gpu.passes.slice(passes)
    return {
      order: gpu.commands
        .slice(commands)
        .filter((c) => c === `render ${SURFACE_COLOUR_PASS}` || c.startsWith('mask')),
      loads: drawn.map((pass) => pass.colors[0]?.loadOp),
      labels: drawn.map((pass) =>
        commandArgs(pass.commands, 'setPipeline').map(
          ([pipeline]) => (pipeline as { label?: string }).label ?? '',
        ),
      ),
    }
  }
  return { ...made, perLight, frame, compiling: () => void (ready = false) }
}

/** The kinds of pass the pipelines a pass drew with belong to, in order, the surface colour's (named by no pass of the lights) left out. */
const kindsOf = (pipelines: string[]) => [
  ...new Set(
    pipelines
      .map((label) => /_(SUN|LOCAL_UNBATCHED|LOCAL|PER_LIGHT|INDIRECT)_/.exec(label)?.[1])
      .filter((kind) => kind !== undefined),
  ),
]

test('without per-light lights the lit image is one pass: the indirect light, the suns, the local lights', async () => {
  const { frame } = await frames()
  const { loads, labels } = await frame()
  assert.deepEqual(loads, ['clear'])
  assert.deepEqual(kindsOf(labels[0]), ['INDIRECT', 'SUN', 'LOCAL'])
  assert.equal(labels[0].filter((label) => /UNBATCHED|PER_LIGHT/.test(label)).length, 0)
})

test('with them, each light is drawn after its mask in a pass of its own, the indirect light in the pass of the batched ones', async () => {
  const { frame, perLight, device } = await frames()
  // The pipelines of the path compile on the first frame that asks, the frames waiting for them: meanwhile the
  // shadowed lights are lit by nothing, and no light reads a mask that was not projected.
  const waiting = await frame(perLight)
  assert.deepEqual(waiting.loads, ['clear'])
  assert.ok(
    !waiting.labels[0].some((label) => /_LOCAL_(?!UNBATCHED)/.test(label)),
    'the batched loop is not drawn',
  )
  await pipelinesSettled(device)
  const { order, loads, labels } = await frame(perLight)
  const colour = `render ${SURFACE_COLOUR_PASS}`
  assert.deepEqual(order, [colour, 'mask 0', colour, 'mask 1', colour])
  assert.deepEqual(loads, ['clear', 'load', 'load'])
  assert.deepEqual(
    kindsOf(labels[0]),
    ['INDIRECT', 'SUN', 'LOCAL_UNBATCHED'],
    'the indirect light and the batched lights, without the shadowed',
  )
  assert.deepEqual(kindsOf(labels[1]), ['PER_LIGHT'])
  assert.deepEqual(kindsOf(labels[2]), ['PER_LIGHT'])
})

test('while the path’s pipelines compile the shadowed lights are left out of the batch and no per-light draw is made', async () => {
  const { frame, perLight, device, compiling } = await frames()
  await frame(perLight)
  await pipelinesSettled(device)
  compiling()
  const { order, loads, labels } = await frame(perLight)
  assert.deepEqual(order, [`render ${SURFACE_COLOUR_PASS}`], 'no mask is encoded')
  assert.deepEqual(loads, ['clear'])
  assert.deepEqual(kindsOf(labels[0]), ['INDIRECT', 'SUN', 'LOCAL_UNBATCHED'])
})

test('the steps of the lit image: the indirect light first, then the batched lights, the per-light draws after the local lights, the views apart', () => {
  assert.deepEqual(litSteps(0), ['indirect', 'suns', 'locals'])
  assert.deepEqual(litSteps(3, 2), ['indirect', 'suns', 'locals', 0, 1])
  assert.deepEqual(litSteps(2, 2), ['visibility'], 'the shadows’ view lights nothing one by one')
  assert.deepEqual(litSteps(1, 2), ['indirect'])
  assert.equal(litSteps(0, 2), litSteps(0, 2), 'one order for a count, held')
})
