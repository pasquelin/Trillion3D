// The tile's box (`vsmLightMayReachTile`, `projectionWgsl.ts`) keeps every light a pixel of the
// tile is in, with the roundings of both tests against it; a lit point not finite keeps them all;
// a pass of one light takes its light as the tile's one candidate, with no box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../lighting/shaderRunF32.fixture.ts'
import {
  VSM_LIGHT_KIND_DIRECTIONAL as DIRECTIONAL,
  VSM_LIGHT_KIND_POINT as POINT,
} from './constants.ts'
import {
  CODE,
  NAMES,
  SCOPE,
  f,
  lightsOf,
  pixelsOf,
  type Light,
  type Pixel,
  type V3,
} from './projectionTiles.fixture.ts'
import { seeded } from './planFrames.fixture.ts'

test('the box test never drops a light a pixel of the tile is in, even with the roundings against it', () => {
  // The pixel's inverse square root two units high (it takes the light more readily), the box's two
  // units low: the reach still holds every light a pixel is in.
  const ulp = (x: number) => 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23)
  const high = (x: number) => {
    const r = f(1 / Math.sqrt(x))
    return r + 2 * ulp(r)
  }
  const low = (x: number) => {
    const r = f(1 / Math.sqrt(x))
    return r - 2 * ulp(r)
  }
  const run = (isqrt: (x: number) => number, lights: Light[]) =>
    shaderRun<{
      vsmLightParticipates: (k: number, info: Pixel['info'], p: V3) => boolean
      vsmLightMayReachTile: (k: number, lo: V3, hi: V3, unbounded: boolean) => boolean
      vsmOrderedKey: (x: V3) => V3
      vsmOrderedValue: (k: V3) => V3
    }>(CODE, NAMES.slice(6, 14), {
      // The float tests in binary32, as a GPU runs them, the inverse square roots against them.
      ...F32_SCOPE,
      ...SCOPE,
      VSM_PROJECTION_KINDS: 0,
      vsmView: { lights },
      inverseSqrt: (x: number) => (x === 0 ? Infinity : isqrt(x)),
    })
  // The keys' integer words exactly: binary32 rounds no bit operation.
  const words = shaderRun<{ vsmOrderedKey: (x: V3) => V3; vsmOrderedValue: (k: V3) => V3 }>(
    CODE,
    ['vsmOrderedKey', 'vsmOrderedValue'],
    SCOPE,
  )
  const rand = seeded(64)
  let reached = 0,
    kept = 0
  for (let round = 0; round < 400; round++) {
    const kind = ['lit', 'mixed', 'far', 'corner'][round % 4]
    const pixels = pixelsOf(rand, [0, 0], kind).filter((p) => p.info.valid)
    if (!pixels.length) continue
    const lights = lightsOf(
      rand,
      16,
      pixels.map((p) => p.shifted),
      kind === 'corner' ? pixels[0].shifted : undefined,
    )
    const pixel = run(high, lights),
      box = run(low, lights)
    // The box from the shipped keys: the greatest key and the greatest complement.
    const keys = pixels.map((p) => words.vsmOrderedKey(p.shifted))
    const hi = words.vsmOrderedValue([0, 1, 2].map((i) => Math.max(...keys.map((k) => k[i]))) as V3)
    const lo = words.vsmOrderedValue(
      [0, 1, 2].map((i) => ~Math.max(...keys.map((k) => ~k[i] >>> 0)) >>> 0) as V3,
    )
    for (let i = 0; i < 3; i++) {
      assert.equal(lo[i], Math.min(...pixels.map((p) => p.shifted[i])), 'the least, exactly')
      assert.equal(hi[i], Math.max(...pixels.map((p) => p.shifted[i])), 'the greatest, exactly')
    }
    for (let k = 0; k < lights.length; k++) {
      const may = box.vsmLightMayReachTile(k, lo, hi, false)
      const any = pixels.some((p) => pixel.vsmLightParticipates(k, p.info, p.shifted))
      if (any) assert.ok(may, `round ${round}: light ${k} reaches a pixel, kept by the box`)
      reached += any ? 1 : 0
      kept += may ? 1 : 0
    }
  }
  assert.ok(reached > 100 && kept < 3 * reached, `${reached} reached, ${kept} kept`)
})

test('a lit point not finite makes every light a candidate: its own test is the device’s', () => {
  const lights = lightsOf(seeded(7), 12, [[0, 0, 0]]).map((l) =>
    l.kind === DIRECTIONAL ? { ...l, kind: POINT } : l,
  )
  const scope = {
    ...SCOPE,
    VSM_PROJECTION_KINDS: 0,
    vsmView: { lights },
    vsmTileBounds: [0, 0, 0, 0, 0, 0],
    vsmTileHeld: 0,
  }
  const run = shaderRun<{
    vsmTileBound: (valid: boolean, p: V3, lane: number) => void
    vsmLightMayReachTile: (k: number, lo: V3, hi: V3, unbounded: boolean) => boolean
  }>(CODE, NAMES.slice(1, 2).concat(NAMES.slice(7, 11)), scope)
  // Far from every light, the box alone keeps none of them; one point not finite keeps them all.
  const far: V3 = [1e6, 1e6, 1e6]
  assert.deepEqual(
    lights.map((_, k) => run.vsmLightMayReachTile(k, far, far, false)),
    lights.map((l) => l.invRadius === 0),
  )
  assert.ok(lights.every((_, k) => run.vsmLightMayReachTile(k, far, far, true)))
  // The bound: a lit finite point sets bit 0 and the keys, a lit point not finite bit 1 alone,
  // an unlit one nothing.
  const bound = (valid: boolean, p: V3) => {
    const s = { ...scope, vsmTileBounds: [0, 0, 0, 0, 0, 0], vsmTileHeld: 0 }
    let held = 0
    const { vsmTileBound } = shaderRun<{
      vsmTileBound: (valid: boolean, p: V3, lane: number) => void
    }>(CODE, ['vsmTileBound', 'vsmOrderedKey', 'isFiniteWord'], {
      ...s,
      atomicOr: (_p: unknown, v: number) => void (held |= v),
    })
    vsmTileBound(valid, p, 0)
    return [held, s.vsmTileBounds.some(Boolean)]
  }
  assert.deepEqual(bound(true, [1, -2, 3]), [1, true])
  assert.deepEqual(bound(true, [1, Infinity, 3]), [3, false])
  assert.deepEqual(bound(true, [NaN, 0, 0]), [3, false])
  assert.deepEqual(bound(false, [1, 2, 3]), [0, false])
})

test('a pass of one light, or of suns alone, takes its lights as the candidates: no box, no barrier for it', () => {
  const entry = CODE.slice(CODE.indexOf('fn vsmProjection('))
  assert.match(
    entry,
    /var candidates=vec2u\(1u,0u\);\n if\(VSM_PROJECTION_KINDS==1u\)\{candidates=vsmLightsBelow\(lightCount\);\}\n else if\(!VSM_PROJECTION_ONE_LIGHT\)\{\n {2}vsmTileBound\(/,
  )
  const { vsmLightsBelow } = shaderRun<{ vsmLightsBelow: (count: number) => number[] }>(
    CODE,
    ['vsmLightsBelow'],
    SCOPE,
  )
  for (const count of [0, 1, 5, 31, 32, 33, 63, 64]) {
    const bits = vsmLightsBelow(count)
    for (let k = 0; k < 64; k++)
      assert.equal(((bits[k >> 5] >>> (k & 31)) & 1) === 1, k < count, `${count}: light ${k}`)
  }
  // The bound, then the lanes' candidates, each behind its barrier; the tile's lights behind a third.
  assert.equal(entry.split('\n}\n')[0].match(/workgroupBarrier\(\);/g)?.length, 3)
})
