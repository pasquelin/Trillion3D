// A frame with no as-is pixel composes through flagless variants, compiled with the others,
// that bind and read no share. Their `composeColor` is the shipped text run as JavaScript: at every
// flag but the as-is one, and at an accumulated share of 0, it gives the flag-reading one's value.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { AS_IS_FLAG } from '../../scene/surfaceModel.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

type Compose = { composeColor: (pixel: object) => unknown }
const hdr = {},
  asIs = {},
  background = { rgb: 0.25 }
/** `composeColor` of `source` on one lit value, one channel wide, and the share texel `read`. */
function composed(source: string, value: object, read: object, view: object) {
  const scope = {
    hdr,
    asIs,
    view,
    textureLoad: (texture: object) => (texture === hdr ? value : read),
    bloomed: (image: object) => image,
    vec2i: (xy: unknown) => xy,
    vec4f: (...parts: unknown[]) => parts,
    linearToSrgb: (c: number) =>
      c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 0.41666) - 0.055,
    toneMap: (c: number, curve: number) => (curve ? c / (1 + c) : Math.min(c, 1)),
  }
  return shaderFunctions<Compose>(source, ['composeColor'], scope).composeColor({ xy: 0 })
}

const channels = [0, -0, 1e-7, 0.002, 0.5, 1, 7.5, 65504, Infinity, NaN]
const coverages = [0, 1e-7, 0.5, 1, NaN]

test('the flagless composition gives the flag-reading one at every share of 0 (OMB-11)', () => {
  const flags = [0, 1, 2, 4, 5]
  assert.ok(!flags.includes(AS_IS_FLAG))
  let checked = 0
  for (const programs of [CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS])
    for (const sources of [programs.plain, programs.bloom]) {
      assert.doesNotMatch(
        sources.flagless,
        /asIs|@group\(0\) @binding\(2\)/,
        'no share bound nor read',
      )
      for (const rgb of channels)
        for (const a of coverages)
          for (const [z, w, x] of [
            [0, 1, 0],
            [0, 0.3, 4],
            [1, 1, 0],
          ]) {
            const view = { background, viewport: { z }, lightParams: { w }, display: { x } }
            const value = { rgb, a },
              flagless = composed(sources.flagless, value, {}, view)
            for (const flag of flags)
              assert.deepEqual(composed(sources.still, value, { r: flag }, view), flagless)
            assert.deepEqual(composed(sources.accumulated, value, { r: 0 }, view), flagless)
            checked++
          }
    }
  assert.equal(checked, 4 * channels.length * coverages.length * 3)
})

test('a flagless frame composes with its own pipelines and binds no share, compiling none', async () => {
  const { device, renderPipelines } = fakeDevice()
  const labels: string[] = [],
    groups: GPUBindGroupEntry[][] = []
  const pass = {
    setPipeline: (pipeline: GPURenderPipelineDescriptor) =>
      void labels.push(pipeline.fragment!.module.label!),
    setBindGroup: (_slot: number, group: GPUBindGroupDescriptor) =>
      void groups.push(group.entries as GPUBindGroupEntry[]),
    draw() {},
    end() {},
  }
  const encoder = { beginRenderPass: () => pass } as unknown as GPUCommandEncoder
  const view = () => ({}) as GPUTextureView
  const flags = view(),
    views = [view(), view(), view(), flags]
  const lighting = await createDeferredLighting(device)
  lighting.bind({ views: () => views } as unknown as SurfaceBuffer, view(), view(), false)
  const compiled = renderPipelines.length,
    image = { color: view(), share: view() }
  for (const asIs of [false, true]) {
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, undefined, asIs)
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image, asIs)
  }
  assert.equal(renderPipelines.length, compiled, 'every variant was compiled with its program')
  assert.deepEqual(labels, [
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_STILL',
    'UNLIT_COMPOSE_ACCUMULATED',
  ])
  const bindings = groups.map((entries) => entries.map((entry) => entry.resource))
  assert.equal(bindings[0].length, 2, 'the lit image and the view, no flags')
  assert.equal(bindings[1].length, 2, 'the accumulated colour and the view, no share')
  assert.equal(bindings[2][2], flags, 'a frame with an as-is pixel reads the flags')
  assert.equal(bindings[3][2], image.share, 'and an accumulated one its share')
  lighting.dispose()
})
