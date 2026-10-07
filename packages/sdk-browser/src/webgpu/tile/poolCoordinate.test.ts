import test from 'node:test'
import assert from 'node:assert/strict'
import {
  POOL_LAYER_SIDE,
  POOL_STEP,
  POOL_SUBTEXEL,
  TILE_BORDER,
  TILE_PITCH,
} from '../../texture/tiles.ts'
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts'
import { TILE_POOL_WGSL } from './wgsl.ts'

type PoolAxis = { poolAxis: (origin: number, texel: number) => number }
const f32 = Math.fround

/** The sub-texel positions the sampler filters for `texel`, one per place of a row, in f32. */
const filtered = (side: number, coordinate: (origin: number, texel: number) => number) => {
  const origins = Array.from({ length: 30 }, (_, i) => i * TILE_PITCH + TILE_BORDER)
  return (texel: number) =>
    new Set(
      origins.map((origin) => {
        const uv = coordinate(origin, texel)
        assert.equal(f32(uv), uv, `pool coordinate is an f32 at ${origin}`)
        return f32(uv * side) - origin
      }),
    )
}

test('a tap filters the same sub-texel position wherever the streamer placed its tile', () => {
  const { poolAxis } = shaderFunctions<PoolAxis>(TILE_POOL_WGSL, ['poolAxis'], {
    POOL_SUBTEXEL,
    POOL_STEP,
  })
  const texels = [0.5, 37.123456789, 63.99999, 100.3, 127.5].map(f32)
  // A 4080 side, and a division the tile's place rounds differently.
  const divided = filtered(4080, (origin, texel) => f32(f32(origin + texel) / 4080))
  assert.ok(
    texels.some((texel) => divided(texel).size > 1),
    'the division filters another position at another place',
  )
  const shipped = filtered(POOL_LAYER_SIDE, poolAxis)
  for (const texel of texels) assert.equal(shipped(texel).size, 1, `texel ${texel}`)
})
