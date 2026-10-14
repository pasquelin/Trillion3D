import test from 'node:test'
import assert from 'node:assert/strict'
import { POOL_LAYER_SIDE, POOL_STEP, POOL_SUBTEXEL, TILE_PITCH } from '../../texture/tiles.ts'
import { TILE_BORDER } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts'
import { POOL_PLACE_WGSL } from './poolPlaceWgsl.ts'

type PoolAxis = { poolAxis: (origin: number, texel: number) => number }

/** The shipped `poolAxis`, run as the shader writes it. */
const shipped = () =>
  shaderFunctions<PoolAxis>(POOL_PLACE_WGSL, ['poolAxis'], {
    POOL_SUBTEXEL,
    POOL_STEP,
    floor: Math.floor,
  }).poolAxis

/** The sub-texel positions the sampler filters for `texel`, one per place of a row, in f32. */
const filtered = (side: number, coordinate: (origin: number, texel: number) => number) => {
  const origins = Array.from({ length: 30 }, (_, i) => i * TILE_PITCH + TILE_BORDER)
  return (texel: number) =>
    new Set(
      origins.map((origin) => {
        const uv = coordinate(origin, texel)
        assert.equal(Math.fround(uv), uv, `pool coordinate is an f32 at ${origin}`)
        return Math.fround(uv * side) - origin
      }),
    )
}

test('a tap filters the same sub-texel position wherever the streamer placed its tile', () => {
  const texels = [0.5, 37.123456789, 63.99999, 100.3, 127.5].map(Math.fround)
  // A 4080 side, and a division the tile's place rounds differently.
  const divided = filtered(4080, (origin, texel) => Math.fround(Math.fround(origin + texel) / 4080))
  assert.ok(
    texels.some((texel) => divided(texel).size > 1),
    'the division filters another position at another place',
  )
  const pool = filtered(POOL_LAYER_SIDE, shipped())
  for (const texel of texels) assert.equal(pool(texel).size, 1, `texel ${texel}`)
})

test("a tap takes the sampler's sub-texel weights of the texel in its own level", () => {
  const poolAxis = shipped(),
    origin = 29 * TILE_PITCH + TILE_BORDER
  // The weight a sampler takes on a grid of `bits` sub-texel steps, from the position less half a
  // texel, truncated or rounded.
  const weights = [8, 10].flatMap((bits) =>
    [Math.floor, Math.round].map((fix) => (x: number) => fix((x - 0.5) * 2 ** bits)),
  )
  // Just under each 8-bit step: the texel coordinate rounded to the pool's grid crossed it.
  for (let step = 1; step < 256; step++) {
    const texel = Math.fround(100 + step / 256 - 2 ** -14)
    const position = Math.fround(poolAxis(origin, texel) * POOL_LAYER_SIDE) - origin
    for (const weight of weights)
      assert.equal(weight(position), weight(texel), `texel ${texel}: the pool moved its weight`)
  }
})
