// The host's clip convention changes nothing the engine draws: the same physical camera (near
// 2.8, far 12) and a tilted tile that crosses the near plane, rendered while the host flips its
// convention — `[−1, 1]` on the WebGL side, `[0, 1]` on the WebGPU side — give the same image
// pixel for pixel, both ways, paged and unpaged. The engine composes its own projection, in
// reversed depth and with an infinite far plane, so the flip changes none of its numbers and the
// held image must stay held (`depthConventionPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { preuveDansLaPage, publieEtVerifie } from '../kit/enginePageProof.ts';

interface Pass {
  frames: { name: string; held: boolean }[];
  red: number;
  toWebgpu: number;
  back: number;
}

test('flipping the host’s clip convention changes no pixel and drops no held image', async () => {
  const reading = (await preuveDansLaPage(
    resolve(import.meta.dirname, 'depthConventionPage.ts'),
    'depthConvention',
    'runConventionFlip',
  )) as Parameters<typeof publieEtVerifie>[0] & { passes: Record<string, Pass> };
  publieEtVerifie(reading);
  for (const [pass, { frames, red, toWebgpu, back }] of Object.entries(reading.passes)) {
    const held = (name: string) => frames.find((frame) => frame.name === name)?.held;
    assert.ok(red > 0, `${pass}: the tilted tile is not seen under the WebGL convention`);
    assert.ok(
      frames.some(({ name, held }) => name.startsWith('webgl-') && held),
      `${pass}: the WebGL image was never held`,
    );
    assert.equal(held('webgpu-0'), true, `${pass}: the flip to WebGPU recomputed the image`);
    assert.equal(toWebgpu, 0, `${pass}: the WebGPU convention draws another image`);
    assert.equal(held('back-0'), true, `${pass}: the flip back to WebGL recomputed the image`);
    assert.equal(back, 0, `${pass}: the flip back does not restore the same image`);
  }
});
