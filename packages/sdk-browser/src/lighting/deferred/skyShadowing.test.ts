// The sky light under the distance fields' occlusion reaches the opaque resolve: the direct program that applies it holds the code
// that reads the image (the diffuse light along the bent normal, the sky's reflection under the specular occlusion) and the
// bindings it is read from; no other program does — not the direct program of an image without one, not the bounce program, whose
// probes carry the sky. The image is lit by the first while the second compiles, and by the second once it is ready.
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { indirectLayoutEntries } from './layoutEntries.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { recorder } from './recorder.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import { TILE_CLASS } from './tileClass.ts'
import { resolvedReflectionOccludedWgsl } from '../reflections/weight.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

const CODE =
  /dfaoBentNormal|skyLightVisibility|skyLightSpecularOcclusion|environmentLightingOccluded/
const BINDINGS = new RegExp(
  `@binding\\((?:${DEFERRED_BINDINGS.dfaoBent}|${DEFERRED_BINDINGS.dfaoRead})\\)`,
)
const KEYS = [{ lobeless: true }, {}, { narrow: true, unshadowed: true, rectless: true }]

test('the direct program that applies the occlusion reads the image into the sky light’s diffuse and specular, and no other does', () => {
  for (const key of KEYS) {
    const plain = contractLightingShader(false, key)
    const applying = contractLightingShader(false, key, true)
    assert.doesNotMatch(plain, CODE, 'the direct program of an image without one')
    assert.doesNotMatch(plain, BINDINGS)
    assert.doesNotMatch(contractLightingShader(true, key), CODE, 'the bounce program')
    assert.match(applying, /var skyBent=N;/)
    assert.match(
      applying,
      /dfaoBentNormal\(pixel\.xy,z\)/,
      'the bent normal at the pixel, read once',
    )
    assert.match(applying, /environmentLightingOccluded\(albedo,base\.a,N,occlusion\.sky,skyVis\)/)
    assert.match(
      applying,
      /resolvedReflectionOccluded\(coord,base\.rgb,base\.a,occlusion\.both,N,V,normal\.a,skySpec\.specular,skySpec\.add\)/,
    )
    assert.equal(applying.match(/dfaoBentNormal\(pixel\.xy,z\)/g)?.length, 1, 'once for the pixel')
    assert.match(
      applying,
      new RegExp(
        `@binding\\(${DEFERRED_BINDINGS.dfaoBent}\\) var<storage,read> dfaoBent:array<vec2u>`,
      ),
    )
    assert.match(
      applying,
      new RegExp(`@binding\\(${DEFERRED_BINDINGS.dfaoRead}\\) var<uniform> dfaoRead`),
    )
  }
  assert.throws(
    () => indirectPassWgsl({ bounce: true, skyShadowing: true, tileClass: TILE_CLASS.single }),
    /no sky shadowing/,
  )
})

test('the program without the occlusion is the text it was: its sky light and its reflection are read as they were', () => {
  const plain = contractLightingShader(false, { lobeless: true })
  assert.match(
    plain,
    /mat2x3f\(vec3f\(0\.0\),resolvedReflection\(coord,occlusion\.both,N,V,normal\.a\)\)/,
  )
  assert.equal(plain.match(/environmentLighting\(albedo,base\.a,N,occlusion\.sky\)/g)?.length, 1)
})

/** `resolvedReflectionOccluded` with the target answering `texel`, the surface reflecting. */
function occluded(texel: number[], coat?: number[]) {
  return shaderRun<{
    resolvedReflectionOccluded: (...args: unknown[]) => number[]
  }>(resolvedReflectionOccludedWgsl, ['resolvedReflectionOccluded'], {
    surfaceModel: 2,
    reflectionTarget: { load: (_: number[], layer: number) => (layer ? [...coat!, 0] : texel) },
    reflectionWeight: () => [0.5, 0.5, 0.5],
    indirectF0: (rgb: number[]) => rgb,
    coatLayerKeep: () => 1,
    hasCoat: () => !!coat,
  }).resolvedReflectionOccluded
}

test('the specular occlusion reaches what the field answered and leaves the rays’ answers as they are', () => {
  const N = [0, 0, 1],
    V = [0, 0, 1]
  const call = (texel: number[], rough = 0.5) =>
    occluded(texel)([0, 0], [0.5, 0.5, 0.5], 0, 0.8, N, V, rough, 0.25, [0.2, 0.4, 0.6])
  // A pixel the trace answered (the screen, the proxy, a walk of the scene): untouched by the sky’s occlusion.
  assert.deepEqual(call([1, 2, 3, 1]), [1, 2, 3])
  // A pixel it left to the field (the alpha −1): the surroundings, the sky light’s specular, under the occlusion and the
  // ambient one, plus the tint of what the occlusion took.
  const left = Math.min(Math.max(Math.pow(Math.max(1 + 0.8, 1e-20), 0.25) - 1 + 0.8, 0), 1)
  const field = call([1, 2, 3, -1])
  field.forEach((c, i) => {
    const expected = ((i + 1) * 0.25 + [0.2, 0.4, 0.6][i] * 0.5) * left
    assert.ok(Math.abs(c - expected) < 1e-6, `${i}: ${c} against ${expected}`)
  })
})

test('the specular occlusion leaves the coat’s share whole and reaches the base lobe’s alone', () => {
  const N = [0, 0, 1],
    V = [0, 0, 1]
  const args = [[0, 0], [0.5, 0.5, 0.5], 0, 0.8, N, V, 0.5, 1, [0, 0, 0]] as const
  const bare = occluded([1, 2, 3, -1])(...args)
  const coated = occluded([1, 2, 3, -1], [10, 20, 30])(...args)
  coated.forEach((c, i) => assert.ok(Math.abs(c - (bare[i] + 10 * (i + 1))) < 1e-6, `${i}`))
  // A pixel the trace answered adds its coat as it is.
  assert.deepEqual(occluded([1, 2, 3, 1], [10, 20, 30])(...args), [11, 22, 33])
})

test('the layout binds the image as a storage buffer and its uniform, within the stage’s limits, in the indirect pass that applies it alone', () => {
  gpuHarness()
  const indirect = (bounce: boolean, skyShadowing: boolean) =>
    indirectLayoutEntries({ bounce, skyShadowing, lobes: true })
  const entries = indirect(false, true)
  const bent = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.dfaoBent)
  const read = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.dfaoRead)
  assert.equal(bent?.buffer?.type, 'read-only-storage', 'no sampled texture is left for it')
  assert.equal(read?.buffer?.type, 'uniform')
  const bindGroupLayouts = [{ entries }] as unknown as GPUBindGroupLayout[]
  for (const { limit, kind, count } of stageBindingCounts({ bindGroupLayouts }))
    assert.ok(count <= limitOf(limit), `${count} ${kind}`)
  for (const bounce of [false, true])
    assert.ok(!indirect(bounce, false).some((e) => e.binding === DEFERRED_BINDINGS.dfaoBent))
})

test('an image with the occlusion is lit by the program that applies it once ready, an image without by the one that does not', async () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  const bent = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM })
  const applied = { lobeless: true, skyShadowing: { bent, params } }
  draw({ lobeless: true })
  await lighting.settle()
  // The program that applies it is asked, and compiles; the image is lit without it meanwhile.
  draw(applied)
  await lighting.settle()
  draw(applied)
  draw({ lobeless: true })
  assert.deepEqual(labels(), [
    'DIRECT_LOBELESS',
    'DIRECT_LOBELESS_SKY_SHADOWING',
    'DIRECT_LOBELESS',
  ])
  // Its group names the image’s buffers; the others’ name none.
  const named = gpu.bindGroups.flatMap((g) =>
    (g.entries as GPUBindGroupEntry[]).filter((e) => e.binding === DEFERRED_BINDINGS.dfaoBent),
  )
  assert.ok(named.length > 0)
  assert.ok(named.every((e) => (e.resource as GPUBufferBinding).buffer === bent))
  lighting.dispose()
})

test('the bounce program is lit with no such program: the sky is its probes’, however the image was occluded', async () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  const bent = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM })
  const grid = device.createBuffer({ size: 4096, usage: GPUBufferUsage.UNIFORM })
  const bounced = {
    ...{ lobeless: true, bounceGrid: grid },
    skyShadowing: { bent, params },
  }
  draw(bounced)
  await lighting.settle()
  draw(bounced)
  assert.ok(labels().length > 0)
  assert.ok(labels().every((label) => !String(label).includes('SKY_SHADOWING')))
  lighting.dispose()
})

test('the frame draws the occlusion before it writes the sky light’s read uniform, where no bounce lights the pixels', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const preLight = read('../../frame/render/preLight.ts')
  // The uniform says whether the image has an occlusion (`mode.y`): written first, it would say the last image’s.
  const at = ['encodeSkyOcclusion(rt, encoder, cam)', 'encodeSkyLight(rt, device, encoder)'].map(
    (call) => preLight.indexOf(call),
  )
  assert.ok(at[0] >= 0 && at[0] < at[1], `each is called, the occlusion first: ${at}`)
  assert.match(
    read('../../frame/render/encodeSkyOcclusion.ts'),
    /rt\.bounce\.wanted \? undefined : skyOcclusionGate\(rt, false\)/,
  )
})
