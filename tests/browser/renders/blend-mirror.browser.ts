import assert from 'node:assert/strict';
import { dansPageWebgpu, empaquetePage as bundlePage } from '../probes/pageWebgpu.ts';
import type { blendMirror } from '../support/blendMirrorPage.ts';

declare global {
  var mirrorProof: { blendMirror: typeof blendMirror };
}
const script = await bundlePage(
  new URL('../support/blendMirrorPage.ts', import.meta.url).pathname,
  'mirrorProof',
);
const result = await dansPageWebgpu(() => globalThis.mirrorProof.blendMirror(), null, {
  script,
  titre: 'Transparent mirror proof',
});
assert.deepEqual(result.compilation, []);
for (const [current, previous] of result.families)
  assert.deepEqual(
    current,
    previous,
    'diffuse/toon must not gain reflections through a dark roughness map',
  );
assert.deepEqual(result.errors, []);
assert.deepEqual(result.mirror, result.repeat, 'still reflection must be identical');
assert.deepEqual(result.off, result.offPrevious, 'bounce off must remain identical');
assert.deepEqual(result.rough, result.roughPrevious, 'rough surfaces must remain identical');
const lit = (pixels: number[]) =>
  pixels.filter((value, index) => index % 4 === 0 && value > 0).length;
assert.equal(lit(result.previous), 0, 'the original missing reflection must be black');
assert.ok(lit(result.mirror) > 100, 'the triangle must be clearly reflected');
assert.ok(lit(result.mirror) < 700, 'the reflected triangle must not fill the entire mirror');
assert.ok(
  result.mirror.filter((value, index) => index % 4 === 3 && value === 0x3c00).length === 1024,
  'all mirror pixels must draw',
);
// Independent geometric oracle: an orthographic mirror returns the triangle at the same x/y.
for (const [image, left, bottom, right, top] of [
  [result.mirror, -0.7, -0.6, 0.6, 0.71],
  [result.second, -0.45, -0.2, 0.4, 0.5],
] as const) {
  for (let y = 0; y < result.width; y++)
    for (let x = 0; x < result.width; x++) {
      const px = -1 + ((x + 0.5) * 2) / result.width,
        py = 1 - ((y + 0.5) * 2) / result.width;
      const inside =
        px >= left &&
        py >= bottom &&
        (px - left) / (right - left) + (py - bottom) / (top - bottom) <= 1;
      assert.equal(
        image[(y * result.width + x) * 4] > 0,
        inside,
        `reflection coverage at ${x},${y}`,
      );
    }
}
console.log(
  JSON.stringify({
    adapter: result.adapter,
    reflectedPixels: [lit(result.mirror), lit(result.second)],
    roughDifferentPixels: 0,
    stillDifferentPixels: 0,
    bounceOffDifferentPixels: 0,
    errors: result.errors,
  }),
);
