// #875: a paged surface draws its normal map as its unpaged twin does. A geometry page stores no
// tangent: a paged transparent rebuilds its frame from screen derivatives
// (`webgpu/blend/shaderSurface.ts`), a paged opaque one from its triangle's texture coordinates
// (`visibility/shader/shadeWgsl.ts`). The unpaged twin, a `shared-blend` primitive, is drawn forward
// from its source buffers and reads the authored tangents (`webgpu/blend/prepare.ts`). The scenes
// are the public `normal-tangent-mirror-test`, whose tangents are mirrored on half its texture,
// blended and opaque (`bench/runner/scenes/tangentScenes.ts`, which prints how to compile them).
//
// - Blended pair: both twins take the forward blend pass, so the tangent source is the only
//   difference, and the two images must be the same to the pixel.
// - Opaque pair: recorded, not asserted. The resolve reads authored tangents only on a row with no
//   geometry page (`HAS_TANGENT`, `shadeWgsl.ts`), which no current cache has: the compiler writes
//   one for every cluster. The only opaque path that reads them is the forward pass of the unpaged
//   twin, another shader than the resolve, so a difference there is not the tangents' alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pixelDifference } from '../../../bench/dawn/capture.ts';
import { readCacheManifest } from '../../../bench/runner/cacheManifest.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import { sceneDerived } from '../../../bench/runner/scene.ts';
import { TANGENT_SCENES } from '../../../bench/runner/scenes/tangentScenes.ts';
import { runOnDawn } from '../kit/onDawn.ts';
import { benchManifest, defaultBackendImage, drawnPixels } from '../world/proofWorld.ts';

/** The bench sun, casting no shadow: the traced shadow read is seeded by the frame number, so an
 *  image held at another frame differs on every shadow edge — the pair would measure how many
 *  frames each image took to settle, not its tangents. */
const LIGHT = { ...SUN, castsShadow: false };

/** The default world of a tangent scene under `LIGHT`: its image, checked drawn. */
async function tangentImage(key: string, scene: string) {
  const errors: string[] = [];
  const read = await runOnDawn(
    () => defaultBackendImage(benchManifest(scene), [LIGHT]),
    null,
    errors,
  );
  assert.deepEqual(errors, [], key);
  assert.equal(read.backend, 'webgpu-page-raster', key);
  assert.ok(read.held, `${key}: the image is held`);
  const drawn = drawnPixels(read.pixels);
  assert.ok(drawn > read.pixels.length / 4 / 20, `${key}: ${drawn} pixels drawn`);
  return read.pixels;
}

test('each tangent scene is compiled to the pass its pair compares', async () => {
  for (const { scene, pass } of TANGENT_SCENES) {
    const { manifest } = await readCacheManifest(join(sceneDerived(scene), 'native/full'));
    assert.ok(manifest.primitives.length > 0, `${scene} compiled no primitive`);
    assert.deepEqual(
      manifest.primitives.map((primitive) => primitive.pass),
      manifest.primitives.map(() => pass),
      `${scene} compiled to ${pass}`,
    );
  }
});

test(
  'a blended paged surface draws its normal map as its unpaged twin',
  { timeout: 300_000 },
  async () => {
    // Interleaved, twice each: the A/A of a scene says what the harness itself moves.
    const images = new Map<string, Uint8Array>();
    for (const run of [1, 2])
      for (const { key, scene } of TANGENT_SCENES)
        images.set(`${key}-${run}`, await tangentImage(key, scene));
    const delta = (a: string, b: string) => pixelDifference(images.get(a)!, images.get(b)!);
    const deltas = Object.fromEntries([
      ...TANGENT_SCENES.map(({ key }) => [`${key} A/A`, delta(`${key}-1`, `${key}-2`)]),
      ...['blend', 'opaque'].map((surface) => [
        `${surface} paged vs unpaged`,
        delta(`${surface}-paged-1`, `${surface}-unpaged-1`),
      ]),
    ]);
    console.log(JSON.stringify(deltas));
    for (const { key } of TANGENT_SCENES)
      assert.equal(deltas[`${key} A/A`].pixels, 0, `${key} A/A`);
    const blend = deltas['blend paged vs unpaged'];
    assert.equal(blend.pixels, 0, `blend paged vs unpaged: ${JSON.stringify(blend)}`);
  },
);
