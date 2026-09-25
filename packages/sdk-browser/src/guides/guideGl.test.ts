// The WebGL2 guide draw, through the frame composer: nothing built while no guide is shown, the
// guides drawn over the engine's image before the frame is kept, depth tested and left unwritten,
// and a held frame redrawn once the page changed them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import type { RenderBackend } from '../backend/types.ts';
import { createFrameComposer } from '../world/render/compose.ts';
import { createTestContext } from '../webgl/core/testContext.fixture.ts';
import { createGuideSet } from './guideSet.ts';

const camera = G.perspectiveCamera();

function engine(held = false) {
  let draws = 0;
  const backend = {
    id: 'engine',
    scene: { background: null },
    frameHeld: held,
    drawHostGeometry: () => draws++,
  } as unknown as RenderBackend;
  return { backend, draws: () => draws };
}

test('a world without guides composes as before: no program, no draw', () => {
  const { gl, of } = createTestContext();
  const compose = createFrameComposer(gl, camera, createGuideSet());
  compose(engine().backend, null);
  assert.equal(of('createProgram').length, 0);
  assert.equal(of('drawArraysInstanced').length, 0);
});

test('guides are drawn over the image, before it is kept, depth tested and unwritten', () => {
  const { gl, of, names, calls } = createTestContext();
  const guides = createGuideSet();
  guides.lines({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0], width: 2 });
  const compose = createFrameComposer(gl, camera, guides);
  compose(engine().backend, null);
  assert.deepEqual(of('drawArraysInstanced')[0], ['TRIANGLES', 0, 6, 2]);
  assert.ok(names().lastIndexOf('drawArraysInstanced') < names().lastIndexOf('blitFramebuffer'));
  assert.deepEqual(of('depthFunc').at(-1), ['LEQUAL'], "the host projection's forward depth");
  assert.deepEqual(of('depthMask').slice(-2), [[false], [true]], 'no depth written, mask restored');
  const program = names().lastIndexOf('useProgram');
  assert.deepEqual(calls[program - 1], { name: 'bindFramebuffer', args: ['FRAMEBUFFER', null] });
  compose(engine().backend, null);
  assert.equal(of('bufferData').length, 1, 'uploaded again only when the guides change');
});

test('a held frame is put back while the guides stand, redrawn once they change', () => {
  const { gl } = createTestContext();
  const guides = createGuideSet();
  const compose = createFrameComposer(gl, camera, guides);
  const first = engine();
  compose(first.backend, null);
  const held = engine(true);
  compose(held.backend, null);
  assert.equal(held.draws(), 0, 'nothing changed: the kept frame');
  guides.points({ positions: [0, 0, 0] });
  compose(held.backend, null);
  assert.equal(held.draws(), 1, 'a guide appeared: the image is drawn again with it');
  compose(held.backend, null);
  assert.equal(held.draws(), 1);
});
