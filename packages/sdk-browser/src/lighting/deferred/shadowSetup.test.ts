// #1369: a pixel sets up what a shadow read needs — its unjittered footprint and point (eight
// neighbour depths, three reconstructions), its receiver offset (recomputed from the visibility
// buffer, #1410) —
// only where its tile's opaque list holds a shadowed light, the one place a shadow is read; the
// program with no shadow code never does. Nothing else reads them, so the sums are the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contractLightingShader } from './shaders.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';

const SETUP = 'if(pixelShadowed(pixel.xy)){shadowSetup(coord,pixel,z,P);}';
const surfaceOf = (shader: string) => shader.slice(shader.indexOf('fn lightSurface('));

test('the surface sets up its shadow read behind the tile flag, and nowhere else', () => {
  for (const [bounce, narrow, shadowed] of [
    [false, false, true],
    [true, true, true],
    [false, false, false],
  ] as const) {
    const shader = contractLightingShader(bounce, narrow, undefined, shadowed);
    const surface = surfaceOf(shader);
    assert.ok(surface.includes(SETUP));
    assert.doesNotMatch(surface, /pixelLevel\(|receiverOffset\(|shadowFootprint=/);
    const setup = shader.slice(shader.indexOf('fn shadowSetup(')).split('\n}')[0];
    for (const read of ['pixelLevel(', 'receiverOffset(pixel'])
      assert.ok(setup.includes(read), read);
    const flag = shader.slice(shader.indexOf('fn pixelShadowed(')).split('\nfn ')[0];
    assert.equal(flag.includes('TILE_SHADOW_BASE'), shadowed, 'the flag, read with shadow code');
    if (!shadowed) assert.ok(flag.startsWith('fn pixelShadowed(pixel:vec2f)->bool{return false;}'));
  }
});

test('pixelShadowed reads its tile flag: one where the list holds a shadowed light', () => {
  const shader = contractLightingShader(false, false);
  const K = wgslConstants(shader);
  const tileLights = new Uint32Array(K.TILE_STRIDE * 4);
  tileLights[1 * K.TILE_STRIDE + K.TILE_SHADOW_BASE] = 1; // tile (1, 0) of a 2 × 2 grid
  const view = { lightParams: { x: 3, y: 2, z: 2 } };
  const { pixelShadowed } = shaderFunctions<{ pixelShadowed: (pixel: object) => boolean }>(
    shader,
    ['pixelShadowed', 'pixelTile'],
    { ...K, view, tileLights },
  );
  const at = (x: number, y: number) => pixelShadowed({ x, y });
  const size = K.TILE_SIZE;
  assert.equal(at(size + 0.5, 0.5), true);
  assert.equal(at(0.5, 0.5), false);
  assert.equal(at(size + 0.5, size + 0.5), false);
  assert.equal(at(2 * size + 0.5, 0.5), false, 'past the grid');
  view.lightParams.x = 0;
  assert.equal(at(size + 0.5, 0.5), false, 'no light');
});
