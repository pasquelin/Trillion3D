// #35: the shadow depth raster keeps a blended caster's opacity as a share of the map texels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_DITHER, BLEND_COVERAGE_WGSL } from './blendCoverage.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { FLAG_BLEND_CASTER } from '../../visibility/types.ts';

test('every 4×4 block of the map keeps round(16 × coverage) texels of a blended caster', () => {
  for (let k = 0; k <= 16; k++) {
    const coverage = k / 16;
    const kept = BLEND_DITHER.filter((threshold) => coverage > threshold).length;
    assert.equal(kept, k, `coverage ${coverage}`);
  }
  // Each quarter of the block keeps its share: the PCF, a texel apart, reads no clump.
  for (const threshold of [0.25, 0.5, 0.75]) {
    const quarters = [0, 1, 2, 3].map((q) => {
      const [x0, y0] = [(q & 1) * 2, (q >> 1) * 2];
      let n = 0;
      for (let y = y0; y < y0 + 2; y++)
        for (let x = x0; x < x0 + 2; x++) if (threshold > BLEND_DITHER[y * 4 + x]) n++;
      return n;
    });
    assert.deepEqual(
      quarters,
      quarters.map(() => threshold * 4),
    );
  }
});

test('the depth raster tests only the blended casters, with the same thresholds', () => {
  assert.ok(SHADOW_DEPTH_SHADER.includes(BLEND_COVERAGE_WGSL));
  assert.ok(BLEND_COVERAGE_WGSL.includes(BLEND_DITHER.join(',')));
  assert.match(
    SHADOW_DEPTH_SHADER,
    new RegExp(`flags&${FLAG_BLEND_CASTER}u\\)!=0u;\\s*if\\(blended&&!blendCasterKeep\\(`),
  );
});
