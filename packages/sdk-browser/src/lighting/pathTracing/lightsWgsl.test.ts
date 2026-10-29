// The path tracer's lights, run in JavaScript from the shipped text: what a sample of a light brings, what a ray that meets the light sees, and that the two agree.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_LIGHT } from './lightRecords.ts'
import { PT_LIGHTS_WGSL, PT_T_MAX } from './lightsWgsl.ts'

type Vec3 = [number, number, number]
interface Sample {
  radianceOverPdf: Vec3
  pdf: number
  direction: Vec3
  distance: number
}
interface Hit {
  radiance: Vec3
  pdf: number
  hitT: number
}

/** A light's record as the shader reads it: place and kind, axis, colour and range, tangent and radius, sizes, shares, indirect factor. */
const record = (
  kind: number,
  position: Vec3,
  axis: Vec3,
  colour: Vec3,
  { range = 0, tangent = [0, 0, 0] as Vec3, radius = 0, size = [0, 0, 0, 0], exponent = 0 } = {},
) => ({
  position: [...position, kind],
  axis: [...axis, 0],
  colour: [...colour, range],
  tangent: [...tangent, radius],
  size,
  shares: [1, 1, exponent, 1],
  extra: [1, 0, 0, 0],
})

const lightsOf = (lights: ReturnType<typeof record>[]) =>
  shaderRun<{
    ptSampleLight: (id: number, e: number[], point: Vec3, normal: Vec3) => Sample
    ptTraceLight: (o: Vec3, d: Vec3, tMin: number, tMax: number, id: number) => Hit
    ptEstimateLight: (id: number, point: Vec3, normal: Vec3) => number
  }>(PT_LIGHTS_WGSL, ['ptSampleLight', 'ptTraceLight', 'ptEstimateLight'], {
    directLights: { lights },
    ptSkyEval: () => [0, 0, 0, 0],
    ptSkySample: () => ({ radiance: [0, 0, 0], pdf: 0, direction: [0, 0, 1] }),
    ptSkyEstimate: () => 0,
  })

test('a sun brings its colour whatever direction of its disk is drawn, over the density of the disk’s solid angle', () => {
  const sin = Math.sin(0.01)
  const { ptSampleLight, ptTraceLight } = lightsOf([
    record(PT_LIGHT.directional, [0, 0, 0], [0, 0, 1], [5, 4, 3], { radius: sin }),
  ])
  const solid = 2 * Math.PI * (1 - Math.cos(0.01))
  for (const e of [
    [0.1, 0.2],
    [0.8, 0.9],
    [0.5, 0.5],
  ]) {
    const s = ptSampleLight(0, e, [0, 0, 0], [0, 0, 1])
    assert.deepEqual(s.radianceOverPdf, [5, 4, 3])
    assert.ok(Math.abs(s.pdf * solid - 1) < 1e-3)
    assert.equal(s.distance, PT_T_MAX)
    assert.ok(s.direction[2] >= Math.cos(0.01) - 1e-6)
  }
  const seen = ptTraceLight([0, 0, 0], [0, 0, 1], 0, PT_T_MAX, 0)
  assert.ok(Math.abs(seen.radiance[0] * solid - 5) < 1e-3)
  assert.ok(Math.abs(seen.pdf * solid - 1) < 1e-3)
  assert.equal(ptTraceLight([0, 0, 0], [0, 1, 0], 0, PT_T_MAX, 0).hitT, 0)
  assert.equal(ptTraceLight([0, 0, 0], [0, 0, 1], 0, 100, 0).hitT, 0)
})

test('a lamp brings its intensity over the squared distance, drawn or met, with the falloff of its range', () => {
  const lamp = record(PT_LIGHT.point, [0, 0, 10], [0, 0, -1], [100, 100, 100], {
    range: 50,
    radius: 0.5,
  })
  const { ptSampleLight, ptTraceLight } = lightsOf([lamp])
  const window = (1 - (10 / 50) ** 4) ** 2
  const s = ptSampleLight(0, [0.3, 0.6], [0, 0, 0], [0, 0, 1])
  assert.ok(Math.abs(s.radianceOverPdf[0] - (100 / 100) * window) < 0.01)
  const seen = ptTraceLight([0, 0, 0], [0, 0, 1], 0, PT_T_MAX, 0)
  assert.ok(seen.hitT > 9.4 && seen.hitT < 9.6)
  assert.ok(Math.abs(seen.radiance[0] / seen.pdf - (100 / 100) * window) < 0.02)
  // beyond its range a lamp brings nothing
  assert.deepEqual(ptSampleLight(0, [0.3, 0.6], [0, 0, -45], [0, 0, 1]).radianceOverPdf, [0, 0, 0])
})

test('a lamp of no size is the point: its density is infinite and its radiance over density the intensity over the squared distance', () => {
  const { ptSampleLight, ptTraceLight } = lightsOf([
    record(PT_LIGHT.point, [0, 3, 4], [0, 0, -1], [25, 25, 25], { range: 100 }),
  ])
  const s = ptSampleLight(0, [0.3, 0.6], [0, 0, 0], [0, 1, 0])
  assert.ok(Math.abs(s.radianceOverPdf[0] - 1 * (1 - (5 / 100) ** 4) ** 2) < 1e-4)
  assert.ok(Math.abs(s.distance - 5) < 1e-4)
  assert.equal(ptTraceLight([0, 0, 0], [0, 0.6, 0.8], 0, PT_T_MAX, 0).hitT, 0)
})

test('a spot lights inside its cone and fades to nothing at its edge', () => {
  const spot = {
    ...record(PT_LIGHT.spot, [0, 0, 10], [0, 0, -1], [100, 100, 100], {
      range: 100,
      size: [0, 0, Math.cos(0.5), 1 / (Math.cos(0.2) - Math.cos(0.5))],
    }),
  }
  const { ptSampleLight } = lightsOf([spot])
  const inside = ptSampleLight(0, [0.3, 0.6], [0, 0, 0], [0, 0, 1]).radianceOverPdf[0]
  const edge = ptSampleLight(0, [0.3, 0.6], [10 * Math.tan(0.5), 0, 0], [0, 0, 1])
    .radianceOverPdf[0]
  const outside = ptSampleLight(0, [0.3, 0.6], [10 * Math.tan(0.7), 0, 0], [0, 0, 1])
    .radianceOverPdf[0]
  assert.ok(inside > 0.9 && edge < 1e-3 && outside === 0)
})

test('a rectangle brings its radiance times the form factor of its face, and a ray that meets it sees the density of drawing that point', () => {
  const rect = record(PT_LIGHT.rect, [0, 0, 10], [0, 0, -1], [2, 2, 2], {
    range: 0,
    tangent: [0, 1, 0],
    size: [2, 1, 0, 0],
  })
  const { ptSampleLight, ptTraceLight, ptEstimateLight } = lightsOf([rect])
  const s = ptSampleLight(0, [0.7, 0.2], [0, 0, 0], [0, 0, 1])
  // radiance over density = L * area * cosine at the face / distance², the face seen almost head on
  const cosine = s.direction[2]
  const expected = (2 * 2 * 1 * cosine) / (s.distance * s.distance)
  assert.ok(Math.abs(s.radianceOverPdf[0] - expected) < 1e-3)
  const met = ptTraceLight([0, 0, 0], s.direction, 0, PT_T_MAX, 0)
  assert.ok(Math.abs(met.hitT - s.distance) < 1e-3)
  assert.ok(Math.abs(met.pdf - s.pdf) < 1e-3 * s.pdf)
  // seen from behind, it brings nothing
  assert.deepEqual(ptSampleLight(0, [0.7, 0.2], [0, 0, 20], [0, 0, -1]).radianceOverPdf, [0, 0, 0])
  assert.equal(ptEstimateLight(0, [0, 0, 20], [0, 0, -1]), 0)
})

test('the estimate of a lamp falls with the squared distance and carries the light’s luminance', () => {
  const { ptEstimateLight } = lightsOf([
    record(PT_LIGHT.point, [0, 0, 10], [0, 0, -1], [100, 100, 100], { range: 1000 }),
  ])
  const near = ptEstimateLight(0, [0, 0, 5], [0, 0, 1])
  const far = ptEstimateLight(0, [0, 0, 0], [0, 0, 1])
  assert.ok(near > 3.5 * far && near < 4.5 * far)
})

test('a rectangle close to the point is drawn by the solid angle it covers: the density is one over it, the same for a sample and for the ray that meets it', () => {
  const rect = record(PT_LIGHT.rect, [0, 0, 1], [0, 0, -1], [1, 1, 1], {
    tangent: [0, 1, 0],
    size: [4, 2, 0, 0],
  })
  const { ptSampleLight, ptTraceLight } = lightsOf([rect])
  // the solid angle of a 4 by 2 rectangle one unit above its centre: 4 asin(sin a sin b) summed over the corners
  const corner = (x: number, y: number) =>
    Math.asin((x / Math.hypot(x, 1)) * (y / Math.hypot(y, 1)))
  const solid = 4 * corner(2, 1)
  for (const e of [
    [0.1, 0.9],
    [0.5, 0.5],
    [0.95, 0.3],
  ]) {
    const s = ptSampleLight(0, e, [0, 0, 0], [0, 0, 1])
    assert.ok(Math.abs(s.pdf * solid - 1) < 2e-3, `pdf ${s.pdf}`)
    const met = ptTraceLight([0, 0, 0], s.direction, 0, PT_T_MAX, 0)
    assert.ok(Math.abs(met.pdf - s.pdf) < 2e-3 * s.pdf)
    assert.ok(Math.abs(met.hitT - s.distance) < 1e-3)
  }
})
