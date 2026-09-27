import test from 'node:test';
import assert from 'node:assert/strict';
import { POOL_LAYER_SIDE, POOL_SUBTEXEL, TILE_BORDER, TILE_PITCH } from '../../texture/tiles.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { TILE_POOL_WGSL } from './wgsl.ts';

type PoolAxis = { poolAxis: (origin: number, texel: number) => number };

test('a tap filters the same sub-texel position wherever the streamer placed its tile (#26)', () => {
  const { poolAxis } = shaderFunctions<PoolAxis>(TILE_POOL_WGSL, ['poolAxis'], {
    POOL_SUBTEXEL,
    POOL_STEP: 1 / (POOL_SUBTEXEL * POOL_LAYER_SIDE),
  });
  // Every place of a row, from the first tile of a layer to the last.
  const origins = Array.from({ length: 30 }, (_, i) => i * TILE_PITCH + TILE_BORDER);
  for (const texel of [0.5, 37.123456789, 63.99999, 100.3, 127.5].map(Math.fround)) {
    const positions = new Set(
      origins.map((origin) => {
        const uv = poolAxis(origin, texel);
        assert.equal(Math.fround(uv), uv, `pool coordinate exact in f32 at ${origin}`);
        // What the sampler filters: the coordinate times the side, less the tile's place.
        return uv * POOL_LAYER_SIDE - origin;
      }),
    );
    assert.equal(positions.size, 1, `texel ${texel} filtered at one position`);
  }
});
