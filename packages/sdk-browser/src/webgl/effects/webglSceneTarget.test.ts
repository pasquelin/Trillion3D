// #840: a scene target whose storage the context refused says so, and its owners (`webglEffects.ts`,
// `../../world/render/renderScale.ts`) make it again at their next draw instead of drawing into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebglSceneTarget } from './webglOutput.ts';
import { refusedNow } from '../core/allocation.ts';
import { createTestContext } from '../core/testContext.fixture.ts';

test('a refused scene target is marked to be made again', () => {
  let refuse = false;
  const { gl } = createTestContext({
    answers: { getError: () => (refuse ? ((refuse = false), 'OUT_OF_MEMORY') : 0) },
  });
  const scene = createWebglSceneTarget(gl as unknown as WebGL2RenderingContext, 8, 4);
  assert.equal(scene.refused, false, 'granted: kept');
  refuse = true;
  assert.equal(refusedNow(gl as unknown as WebGL2RenderingContext), true);
  assert.equal(scene.refused, true, 'refused: made again, never drawn into');
});
