// An engine that draws on the host surface says when its frame cannot change: a held frame put
// the whole scene back through the renderer while the engine had just said so. It is now one
// copy each way, on an explicit texture of the drawing buffer — the canvas keeps nothing from
// frame to frame, `preserveDrawingBuffer` being false — with no program and no conversion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeldFrame } from './explorerHeldFrame.ts';
import { createTestContext } from './webglTestContext.ts';

test('nothing is kept until a complete frame has been copied', () => {
  const { gl } = createTestContext();
  const held = createHeldFrame(gl);
  assert.equal(held.holds(8, 4), false, 'the first frame must be drawn');
});

test('the kept frame is put back by a single blit, and nothing of the scene', () => {
  const { gl, of, names } = createTestContext();
  const held = createHeldFrame(gl);
  held.keep(8, 4);
  assert.equal(of('blitFramebuffer').length, 1, 'the complete frame is copied once');
  assert.equal(of('texImage2D').length, 1, 'one raw texture at the drawing-buffer size');
  assert.equal(of('texImage2D')[0][2], 'RGBA8', 'raw bytes, no colour space on either side');
  assert.equal(held.holds(8, 4), true);
  held.present();
  held.present();
  assert.equal(of('blitFramebuffer').length, 3, 'each held frame costs exactly one copy');
  assert.equal(of('texImage2D').length, 1, 'a held frame copies nothing: it rereads what it kept');
  assert.ok(!names().includes('useProgram') && !names().includes('drawArrays'), 'no program');
  // The copy reads the kept texture and writes the drawing buffer: read bound, draw null.
  const [read, draw] = of('bindFramebuffer').slice(-3, -1);
  assert.deepEqual([read[0], draw[0], draw[1]], ['READ_FRAMEBUFFER', 'DRAW_FRAMEBUFFER', null]);
  assert.ok(read[1] !== null, 'the kept framebuffer is read');
});

test('a resize drops the kept frame: it no longer describes the target', () => {
  const { gl, of } = createTestContext();
  const held = createHeldFrame(gl);
  held.keep(8, 4);
  assert.equal(held.holds(4, 2), false, 'another size is not this image');
  held.keep(4, 2);
  assert.equal(of('deleteTexture').length, 1, 'the old copy is released');
  assert.equal(held.holds(4, 2), true);
  assert.equal(held.holds(8, 4), false);
});

test('a lost context loses the copy: the frame is drawn again and kept on the new one', () => {
  const { gl, of, canvas, state } = createTestContext();
  const held = createHeldFrame(gl);
  held.keep(8, 4);
  state.lost = true;
  assert.equal(held.holds(8, 4), false, 'the kept names belong to the dead context');
  canvas.dispatch('webglcontextlost');
  state.lost = false;
  canvas.dispatch('webglcontextrestored');
  assert.equal(held.holds(8, 4), false, 'nothing was kept on the restored context yet');
  held.keep(8, 4);
  assert.equal(of('createTexture').length, 2, 'rebuilt on the restored context');
  assert.equal(held.holds(8, 4), true);
  held.dispose();
  assert.equal(held.holds(8, 4), false);
});
