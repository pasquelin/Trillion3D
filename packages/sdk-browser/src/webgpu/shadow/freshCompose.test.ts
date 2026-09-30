// #1275: the pages the GPU draws itself, composed by the shipped WGSL (`freshWgsl.ts`) over a mock
// device: each is the projection and the cull volume the host composes for the same page
// (`writeLampPage`, `writeSunSquare`, on the one page model), placed where the host places it
// (`writePage`) and readable; and the casters the depth shader draws for it land on its square of
// the pool's layer, its fragments kept to its page alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_FACE_STRIDE } from '../../gpu/shadow/batchBudget.ts';
import { createShadowRecordPack } from '../../gpu/shadow/recordPack.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';

const SHADOW_FACE_READ_WORDS = 24;

const SIDE = 16;
const close = (gpu: number, host: number, what: string) =>
  assert.ok(
    Math.abs(gpu - host) <= 1e-5 * Math.max(1, Math.abs(host)),
    `${what}: ${gpu} ≠ ${host}`,
  );

test("a GPU-drawn page's casters land on its square of the layer, its fragments on it alone", () => {
  const pack = createShadowRecordPack(SHADOW_FACE_STRIDE, SIDE),
    size = SIDE * SHADOW_PAGE;
  const { freshPlace, freshInPage } = shaderRun<{
    freshPlace: (view: object, p: number[]) => number[];
    freshInPage: (view: object, at: number[]) => boolean;
  }>(SHADOW_DEPTH_SHADER, ['freshPlace', 'freshInPage'], {});
  for (const page of [0, 5, 17, SIDE * SIDE - 1]) {
    pack.writePage(0, new Float32Array(16), 0, page, undefined, 0);
    const words = pack.facePacked,
      params = [...words.subarray(16, 20)],
      rect = [...words.subarray(SHADOW_FACE_READ_WORDS, SHADOW_FACE_READ_WORDS + 4)],
      view = { view: { params }, rect };
    const { x, y } = pageOrigin(page, SIDE);
    // The page's clip square, at a perspective w: its corners land on its first and last texels.
    for (const [cx, cy] of [
      [-1, -1],
      [1, 1],
    ]) {
      const [px, py, , w] = freshPlace(view, [cx * 2, cy * 2, 0.5, 2]);
      close(((px / w + 1) / 2) * size, x + ((cx + 1) / 2) * SHADOW_PAGE, `page ${page} x`);
      close(((1 - py / w) / 2) * size, y + ((1 - cy) / 2) * SHADOW_PAGE, `page ${page} y`);
    }
    const inside = (dx: number, dy: number) => freshInPage(view, [x + dx, y + dy]);
    assert.ok(inside(0.5, 0.5) && inside(SHADOW_PAGE - 0.5, SHADOW_PAGE - 0.5), `page ${page}`);
    assert.ok(!inside(-0.5, 0.5) && !inside(0.5, SHADOW_PAGE + 0.5), `page ${page}: beside it`);
  }
});
