// The Three reference witness receives lights from contract: one test per behavior, headless.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { Light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { createWitnessLighting } from './witnessPage.ts'
import type { MeasuredWorld } from '../../witnesses/measurement.ts'

const DOUCEUR = 0.02

interface LightRecord {
  id: string
  kind: 'point' | 'directional' | 'spot'
  position?: number[]
  direction?: number[]
  color: number[]
  intensity: number
  range?: number
  coneAngle?: number
  castsShadow: boolean
}

interface Backend {
  refreshSceneLighting: () => void
}

/** A paper explorer: light store, published settings, backends to notify. */
function explorateur(lights: LightRecord[], backends: Backend[] = []): MeasuredWorld {
  return {
    lights: () => lights.map((light) => ({ ...light })),
    lightSettings: { spotEdgeSoftness: DOUCEUR },
    backends,
  } as unknown as MeasuredWorld
}

const PONCTUELLE: LightRecord = {
  id: 'p1',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 40,
  range: 12,
  castsShadow: true,
}
const SUN: LightRecord = {
  id: 's',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 3,
  castsShadow: true,
}
const PROJECTEUR: LightRecord = {
  id: 'j',
  kind: 'spot',
  position: [0, 5, 0],
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 20,
  range: 10,
  coneAngle: 0.5,
  castsShadow: false,
}

test('a point light from contract becomes a graph light with same range and decay', () => {
  const lighting = createWitnessLighting(G)
  lighting.suivre(explorateur([PONCTUELLE]))
  const [lamp] = lighting.group.children as Light[]
  assert.ok(lamp.kind === 'point')
  assert.deepStrictEqual(G.xyz(lamp.position), [1, 2, 3])
  assert.strictEqual(lamp.distance, 12)
  assert.strictEqual(lamp.decay, 2)
  assert.strictEqual(lamp.intensity, 40)
  assert.deepStrictEqual([lamp.color.r, lamp.color.g, lamp.color.b], [1, 0.5, 0.25])
})

test('a directional light is placed opposite to its propagation, target at origin', () => {
  const lighting = createWitnessLighting(G)
  lighting.suivre(explorateur([SUN]))
  const [lamp] = lighting.group.children as Light[]
  assert.ok(lamp.kind === 'directional')
  // `-0` and `0` are the same position: comparison concerns values, not sign.
  assert.deepStrictEqual(
    G.xyz(lamp.position).map((valeur: number) => valeur + 0),
    [0, 1, 0],
  )
  assert.deepStrictEqual(G.xyz(lamp.target.position), [0, 0, 0])
})

test('a spot light preserves half-angle and edge softness from engine', () => {
  const lighting = createWitnessLighting(G)
  lighting.suivre(explorateur([PROJECTEUR]))
  const [lamp] = lighting.group.children as Light[]
  assert.ok(lamp.kind === 'spot')
  assert.strictEqual(lamp.angle, 0.5)
  // Three softens from `cos(angle)` to `cos(angle(1 − penumbra))`; engine from `cos θ` to `cos θ + softness`.
  const bord = Math.cos(lamp.angle! * (1 - lamp.penumbra!))
  assert.ok(Math.abs(bord - (Math.cos(0.5) + DOUCEUR)) < 1e-9, `bord ${bord}`)
  assert.deepStrictEqual(G.xyz(lamp.target.position), [0, -5, 0])
})

test('no cast shadows on witness side: SDK Three renderer has no maps', () => {
  const lighting = createWitnessLighting(G)
  const resume = lighting.suivre(explorateur([PONCTUELLE, SUN]))
  assert.strictEqual(resume?.shadows, false)
  for (const lamp of lighting.group.children as Light[]) assert.strictEqual(lamp.castShadow, false)
})

test('summary counts received lights by type in store order', () => {
  const lighting = createWitnessLighting(G)
  const resume = lighting.suivre(explorateur([PONCTUELLE, SUN, PROJECTEUR]))
  assert.deepStrictEqual(resume, {
    count: 3,
    points: 1,
    spots: 1,
    directional: 1,
    ids: ['p1', 's', 'j'],
    shadows: false,
  })
})

test('moving a light does not trigger a scene refresh, adding one does', () => {
  let reprises = 0
  const backend = { refreshSceneLighting: () => reprises++ }
  const lights = [{ ...PONCTUELLE }]
  const explorer = explorateur(lights, [backend])
  const lighting = createWitnessLighting(G)
  lighting.suivre(explorer)
  assert.strictEqual(reprises, 1)
  lights[0].position = [9, 9, 9]
  lighting.suivre(explorer)
  assert.strictEqual(reprises, 1)
  assert.deepStrictEqual(G.xyz(lighting.group.children[0].position), [9, 9, 9])
  lights.push({ ...SUN })
  lighting.suivre(explorer)
  assert.strictEqual(reprises, 2)
  assert.strictEqual(lighting.group.children.length, 2)
})

test('a dist prior to contract returns null, never an invented count', () => {
  const lighting = createWitnessLighting(G)
  assert.strictEqual(lighting.suivre({ backends: [] } as unknown as MeasuredWorld), null)
  assert.strictEqual(lighting.group.children.length, 0)
})
