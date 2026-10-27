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
      /resolvedReflectionOccluded\(coord,base\.rgb,base\.a,occlusion\.both,N,V,normal\.a,skySpec\.specular,skySpec\.add,skyCoat\.specular,skyCoat\.add\)/,
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
    /mat2x3f\(vec3f\(0\.0\),resolvedReflection\(coord,base\.rgb,base\.a,occlusion\.both,N,V,normal\.a\)\)/,
  )
  assert.equal(plain.match(/environmentLighting\(albedo,base\.a,N,occlusion\.sky\)/g)?.length, 1)
})

/** `resolvedReflectionOccluded` over a reflection target of two layers: 0 the rays' answer, its alpha the base
 *  lobe's share they answered (-1 for none); 1 the environment through the base lobe, `rough`, and in its alpha the share left to
 *  the coat's lobe, `coatLeft`, a pixel with a coat when given. The surface reflects; `reflectionShare` sums the lights of the lobes. */
function occluded(
  texel: number[],
  { coatLeft, rough = [0, 0, 0] }: { coatLeft?: number; rough?: number[] } = {},
) {
  return shaderRun<{
    resolvedReflectionOccluded: (...args: unknown[]) => number[]
  }>(resolvedReflectionOccludedWgsl, ['resolvedReflectionOccluded'], {
    surfaceModel: 2,
    view: { reflection: [1, 1, 0, 0] },
    reflectionTarget: {
      load: (_: number[], layer: number) => (layer === 0 ? texel : [...rough, coatLeft ?? 0]),
    },
    reflectionWeight: () => [0.5, 0.5, 0.5],
    indirectF0: (rgb: number[]) => rgb,
    coatLayerKeep: () => 1,
    hasCoat: () => coatLeft !== undefined,
    reflectionShare: (lights: { base: number[]; coat: number[] }) =>
      lights.base.map((c, i) => c + lights.coat[i]),
  }).resolvedReflectionOccluded
}

/** The specular occlusion at a view along the normal, an occlusion of 0.8 and a roughness of 0.5: the roughness squared the exponent. */
const SPECULAR_OCCLUSION = Math.min(Math.max(Math.pow(1 + 0.8, 0.25) - 1 + 0.8, 0), 1)

test('the specular occlusion reaches what the field answered and leaves the rays’ answers as they are', () => {
  const N = [0, 0, 1],
    V = [0, 0, 1]
  const call = (texel: number[]) =>
    occluded(texel, { rough: [1, 2, 3] })(
      [0, 0],
      [0.5, 0.5, 0.5],
      0,
      0.8,
      N,
      V,
      0.5,
      0.25,
      [0.2, 0.4, 0.6],
      1,
      [0, 0, 0],
    )
  // A pixel the trace answered whole (the screen, the proxy, a walk of the scene): untouched by the sky’s occlusion.
  assert.deepEqual(call([1, 2, 3, 1]), [1, 2, 3])
  // A pixel it left to the field (the alpha −1): the surroundings, the sky light’s specular, under the occlusion and the
  // ambient one, plus the tint of what the occlusion took.
  call([0, 0, 0, -1]).forEach((c, i) => {
    const expected = ((i + 1) * 0.25 + [0.2, 0.4, 0.6][i] * 0.5) * SPECULAR_OCCLUSION
    assert.ok(Math.abs(c - expected) < 1e-6, `${i}: ${c} against ${expected}`)
  })
  // A pixel the trace answered in part (alpha 0.25): its answer whole, and the rest of the base lobe left to the field.
  call([1, 2, 3, 0.25]).forEach((c, i) => {
    const expected = i + 1 + 0.75 * ((i + 1) * 0.25 + [0.2, 0.4, 0.6][i] * 0.5) * SPECULAR_OCCLUSION
    assert.ok(Math.abs(c - expected) < 1e-6, `${i}: ${c} against ${expected}`)
  })
})

test('the coat’s rough share goes under the specular occlusion of the material and the screen, and takes the sky’s pair of the base lobe none', () => {
  const N = [0, 0, 1],
    V = [0, 0, 1]
  // The coat’s rough part takes the specular occlusion. A sky specular of 1 and no
  // tint: the sky’s occlusion leaves the base lobe’s environment as it is, so what the coat adds stands apart.
  const args = [[0, 0], [0.5, 0.5, 0.5], 0, 0.8, N, V, 0.5, 1, [0, 0, 0], 1, [0, 0, 0]] as const
  const rough = [1, 2, 3]
  const bare = occluded([0, 0, 0, -1], { rough })(...args)
  const coated = occluded([0, 0, 0, -1], { rough, coatLeft: 0.5 })(...args)
  coated.forEach((c, i) =>
    assert.ok(Math.abs(c - (bare[i] + 0.5 * (i + 1) * SPECULAR_OCCLUSION)) < 1e-6, `${i}`),
  )
  // The coat's own sky occlusion scales its rough share, as the base lobe's scales the base's.
  const halfSky = occluded([0, 0, 0, -1], { rough, coatLeft: 0.5 })(
    ...args.slice(0, 9),
    0.5,
    [0, 0, 0],
  )
  halfSky.forEach((c, i) =>
    assert.ok(Math.abs(c - (bare[i] + 0.5 * 0.5 * (i + 1) * SPECULAR_OCCLUSION)) < 1e-6, `${i}`),
  )
  // A coat the rays answered whole is in their colour already: it adds nothing of its own.
  assert.deepEqual(occluded([1, 2, 3, 1], { coatLeft: 0, rough })(...args), [1, 2, 3])
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
  const at = ['encodeSkyOcclusion(rt, encoder, cam)', 'writeSkyLightParams(rt, device)'].map(
    (call) => preLight.indexOf(call),
  )
  assert.ok(at[0] >= 0 && at[0] < at[1], `each is called, the occlusion first: ${at}`)
  // The capture (in the lights) precedes the uniform (in the pre-light passes) in the image.
  const surfaces = read('../../frame/render/surfaceLighting.ts')
  const frame = [surfaces.indexOf('encodeDirectLights('), surfaces.indexOf('encodePreLight(')]
  assert.ok(frame[0] >= 0 && frame[0] < frame[1], `the lights, then the pre-light passes: ${frame}`)
  assert.match(
    read('../../frame/render/encodeSkyOcclusion.ts'),
    /rt\.bounce\.wanted \? undefined : skyOcclusionGate\(rt, false\)/,
  )
})
