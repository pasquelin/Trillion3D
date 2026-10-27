// The big change of the lighting the bounce follows (`globalLighting.ts`): the colour of the sun and of the sky light measured against the last
// image's, and what a change of more than four times, up or down, asks of the probes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdSkyLight } from '../render/skyLightHeld.ts'
import { followGlobalLighting } from './globalLighting.ts'

/** A store of lights as the declared records hold them. */
function storeOf(lights: Record<string, unknown>[]) {
  const records = new Map(lights.map((light, at) => [`l${at}`, light]))
  return { ids: [...records.keys()], light: (id: string) => records.get(id) as never }
}

/** The runtime of an image whose last sun colour was `sunColour`, lit by `lights`, followed once: the colour the bounce keeps and whether the probes were discarded. */
function followed(sunColour: number, lights: Record<string, unknown>[]) {
  const rt = {
    bounce: {
      sunColour,
      skyColour: 0,
      historyLost: false,
    },
    context: {},
    lights: { store: storeOf(lights) },
  }
  let discarded = 0
  followGlobalLighting(rt as never, { discard: () => discarded++ })
  return { kept: rt.bounce.sunColour, discarded: discarded === 1, lost: rt.bounce.historyLost }
}

test('a colour changes greatly when it grows or shrinks by more than four times, or appears or goes', () => {
  const changesTo = (before: number, now: number) =>
    followed(before, now > 0 ? [{ kind: 'directional', color: [1, 1, 1], intensity: now }] : [])
      .discarded
  assert.equal(changesTo(1, 4), false, 'four times: not more')
  assert.equal(changesTo(1, 4.01), true)
  assert.equal(changesTo(4, 1), false)
  assert.equal(changesTo(4.01, 1), true)
  assert.equal(changesTo(2, 2), false)
  assert.equal(changesTo(0, 0), false, 'no light, no light')
  assert.equal(changesTo(0, 0.5), true, 'a light appears')
  assert.equal(changesTo(0.5, 0), true, 'a light goes')
})

test('the sun is the first directional light that gives indirect light: its greatest channel times its intensity, untinted by the air', () => {
  const sun = { kind: 'directional', color: [1, 0.5, 0.25], intensity: 3 }
  const point = { kind: 'point', color: [1, 1, 1], intensity: 50 }
  assert.equal(followed(0, []).kept, 0)
  assert.equal(followed(0, [point]).kept, 0)
  assert.equal(followed(0, [point, sun]).kept, 3)
  const noIndirect = { ...sun, indirectLightingIntensity: 0 }
  assert.equal(
    followed(0, [noIndirect, { ...sun, color: [0.5, 2, 0], intensity: 2 }]).kept,
    4,
    'one that gives no indirect light is passed over',
  )
})

test('a big change of the sun’s colour discards the probes, once, where the setting allows; the colours are kept either way', () => {
  const sunWith = (intensity: number) =>
    storeOf([{ kind: 'directional', color: [1, 1, 1], intensity }])
  const run = (propagate: boolean) => {
    const rt = {
      bounce: {
        sunColour: 0,
        skyColour: 0,
        historyLost: false,
      },
      context: { surfaceCachePropagateGlobalLightingChange: propagate },
      lights: { store: sunWith(1) },
    }
    let discarded = 0
    const probes = { discard: () => discarded++ }
    const follow = (intensity: number) => {
      rt.lights.store = sunWith(intensity)
      followGlobalLighting(rt as never, probes)
      return discarded
    }
    return { rt, follow }
  }
  const on = run(true)
  assert.equal(on.follow(1), 1, 'the sun appears')
  assert.equal(on.rt.bounce.historyLost, true, 'the screen probes read no history in that image')
  assert.equal(on.follow(1.5), 1, 'a small change follows at the budget')
  assert.equal(on.rt.bounce.historyLost, false, 'the next image reads its history again')
  assert.equal(on.follow(0.5), 1, 'down to a third of the last image’s: not a big change')
  assert.equal(on.follow(0.1), 2, 'down to a fifth of it: a big change')
  assert.ok(Math.abs(on.rt.bounce.sunColour - 0.1) < 1e-6, 'the colour is kept')
  const off = run(false)
  assert.equal(off.follow(1), 0)
  assert.equal(off.rt.bounce.sunColour, 1, 'the colour is kept though nothing is discarded')
  assert.equal(off.follow(100), 0)
  assert.equal(off.rt.bounce.historyLost, false, 'nothing followed at once: the history is read')
})

test('a sky light is read by its colour: its greatest channel times its intensity', () => {
  const rt = {
    bounce: {
      sunColour: 0,
      skyColour: 0,
      historyLost: false,
    },
    context: {},
    lights: { store: storeOf([]) },
  }
  const part = (intensity: number) =>
    ({
      light: {
        color: [0.5, 1, 0.25],
        intensity,
        realTimeCapture: false,
        sourceType: 'specifiedCubemap',
      },
      quality: { skyLightIntensityScale: 1 },
    }) as never
  let discarded = 0
  const probes = { discard: () => discarded++ }
  holdSkyLight(rt, part(1))
  followGlobalLighting(rt as never, probes)
  assert.deepEqual([discarded, rt.bounce.skyColour], [1, 1])
  holdSkyLight(rt, part(2))
  followGlobalLighting(rt as never, probes)
  assert.deepEqual([discarded, rt.bounce.skyColour], [1, 2])
  holdSkyLight(rt, part(9))
  followGlobalLighting(rt as never, probes)
  assert.deepEqual([discarded, rt.bounce.skyColour], [2, 9])
  holdSkyLight(rt, undefined)
  followGlobalLighting(rt as never, probes)
  assert.deepEqual([discarded, rt.bounce.skyColour], [3, 0], 'the sky light goes')
})
