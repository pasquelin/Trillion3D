// The screen probes among the frame's passes: the order the frame calls them in, read from its source.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('the frame stages the reflections, runs the screen probes, the radiance cache the screen probes did not update after them, the translucency lighting, the reflections’ trace, the occlusion after that, and the lighting binds their results after all', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const preLight = read('../../frame/render/preLight.ts')
  const order = [
    'stageReflections(rt, reflects(overrides))',
    'placeScreenProbes(rt, encoder)',
    'encodeQueuedBounce(rt, encoder, placed?.marks)',
    'traceScreenProbes(rt, encoder, placed)',
    'flushRadianceCache(rt, encoder)',
    'encodeTranslucencyGi(rt, device, encoder, cam)',
    'traceReflections(rt, encoder, reflections)',
    'encodeAmbientOcclusion(rt, encoder, cam)',
  ]
  const at = order.map((call) => preLight.indexOf(call))
  assert.ok(
    at.every((index) => index >= 0),
    `each is called: ${at}`,
  )
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    'in this order',
  )
  const surfaces = read('../../frame/render/surfaceLighting.ts')
  assert.ok(
    surfaces.indexOf('encodePreLight(rt, device, encoder, cam, direct, overrides)') <
      surfaces.indexOf('lightSurfaces(rt, encoder, clear, raw, direct, !traced || traced.wiper)'),
    'the lighting binds after the passes it reads',
  )
})

// Retaken when the volume and the scattering became one step (`encodeVolumeAndScattering`,
// `surfaceLighting.ts`, 49172391ca): the frame calls the step, and the step builds the volume first.
test('the frame builds the translucency lighting volume once the surfaces are lit, before the subsurface scattering and the blends that read it, and not in the pre-light step', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.ok(!read('../../frame/render/preLight.ts').includes('encodeTranslucencyVolume'))
  const frame = read('../../frame/render/surfaceLighting.ts')
  const inFrame = (call: string) =>
    frame.indexOf(call, frame.indexOf('export function encodeSurfaceLighting'))
  const order = [
    'encodePreLight(rt, device, encoder, cam, direct, overrides)',
    'lightSurfaces(rt, encoder, clear, raw, direct, !traced || traced.wiper)',
    'encodeVolumeAndScattering(rt, device, encoder, cam)',
    'drawOverLit(',
  ].map(inFrame)
  assert.ok(
    order.every((at) => at >= 0),
    `each is called: ${order}`,
  )
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'in this order',
  )
  // The step builds the volume, then scatters the subsurface light over the lit image.
  const step = frame.slice(frame.indexOf('function encodeVolumeAndScattering'))
  const built = [
    'encodeTranslucencyVolume(rt, device, volumeRun.begin(encoder), cam)',
    'encodeSubsurfaceScattering(rt, encoder, cam)',
  ].map((call) => step.indexOf(call))
  assert.ok(
    built.every((at) => at >= 0) && built[0] < built[1],
    `the volume before the scattering: ${built}`,
  )
})
