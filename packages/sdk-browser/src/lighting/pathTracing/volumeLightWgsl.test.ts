// The stretch of a ray a lamp lights in a volume, run in JavaScript from the shipped text: what stretch it keeps, and that the point drawn on it has the density it says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_LIGHT } from './lightRecords.ts'
import { PT_VOLUME_LIGHT_WGSL } from './volumeLightWgsl.ts'

type Vec3 = [number, number, number]
interface Setup {
  tMin: number
  tMax: number
  importance: number
  height: number
}

const lamp = (kind: number, position: Vec3, range: number, exponent = 0) => ({
  position: [...position, kind],
  axis: [0, 0, -1, 0],
  colour: [2, 1, 1, range],
  tangent: [0, 0, 0, 0],
  size: [0, 0, 0, 0],
  shares: [1, 1, exponent, 1],
  extra: [1, 0, 1, 1],
})

const run = (lights: ReturnType<typeof lamp>[]) =>
  shaderRun<{
    ptPrepareVolumeLight: (id: number, ro: Vec3, rd: Vec3, tMin: number, tMax: number) => Setup
    ptVolumeDistance: (setup: Setup, e: number) => [number, number]
  }>(PT_VOLUME_LIGHT_WGSL, ['ptPrepareVolumeLight', 'ptVolumeDistance'], {
    directLights: { lights },
    ptSkyEval: () => [0, 0, 0, 0],
    ptSkySample: () => ({ radiance: [0, 0, 0], pdf: 0, direction: [0, 0, 1] }),
    ptSkyEstimate: () => 0,
  })

test('a lamp keeps the part of the ray inside its range, and the density of the point drawn integrates to the length kept', () => {
  const { ptPrepareVolumeLight, ptVolumeDistance } = run([lamp(PT_LIGHT.point, [3, 1, 0], 4)])
  const setup = ptPrepareVolumeLight(0, [0, 0, 0], [1, 0, 0], 0, 100)
  const half = Math.sqrt(16 - 1)
  assert.equal(setup.tMin, 0)
  assert.ok(Math.abs(setup.tMax - (3 + half)) < 1e-4)
  assert.ok(setup.height > 0)
  let inverse = 0
  const n = 4000
  for (let i = 0; i < n; i++) {
    const [t, pdf] = ptVolumeDistance(setup, (i + 0.5) / n)
    assert.ok(t > setup.tMin && t < setup.tMax)
    inverse += 1 / pdf / n
  }
  assert.ok(Math.abs(inverse - (setup.tMax - setup.tMin)) < 1e-2)
})

test('a lamp the ray does not reach gives no stretch, and a falloff that is not the inverse square draws evenly', () => {
  const { ptPrepareVolumeLight, ptVolumeDistance } = run([
    lamp(PT_LIGHT.point, [0, 50, 0], 4),
    lamp(PT_LIGHT.point, [3, 1, 0], 4, 2),
  ])
  const none = ptPrepareVolumeLight(0, [0, 0, 0], [1, 0, 0], 0, 100)
  assert.ok(!(none.tMin < none.tMax))
  const even = ptPrepareVolumeLight(1, [0, 0, 0], [1, 0, 0], 0, 100)
  const [t, pdf] = ptVolumeDistance(even, 0.5)
  assert.ok(Math.abs(t - 0.5 * (even.tMin + even.tMax)) < 1e-4)
  assert.ok(Math.abs(pdf - 1 / (even.tMax - even.tMin)) < 1e-6)
})

test('a ray through the centre of a lamp is drawn evenly, not by an angle that does not exist', () => {
  const { ptPrepareVolumeLight, ptVolumeDistance } = run([lamp(PT_LIGHT.point, [3, 0, 0], 4)])
  const setup = ptPrepareVolumeLight(0, [0, 0, 0], [1, 0, 0], 0, 100)
  const [, pdf] = ptVolumeDistance(setup, 0.3)
  assert.ok(Number.isFinite(pdf) && pdf > 0)
})
