import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageKind } from './cutoutDraw.mts';
import { encodePng } from './png.mts';
import { answerOf } from './cutoutShow.mts';

// Behaviour: each terminal gets what it knows how to display, and nothing is guessed — capability
// is read from the environment, with the block mosaic as a universal fallback.
test('each terminal gets what it knows how to display', () => {
  assert.equal(imageKind({ TERM: 'xterm-kitty' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'WarpTerminal' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'iTerm.app' }), 'iterm');
  assert.equal(imageKind({ TERM: 'xterm-256color' }), 'blocks');
  assert.equal(imageKind({}), 'blocks');
});

// Behaviour: one key means one thing only; Enter follows the proposal, and an unknown key answers
// nothing rather than deciding at random.
test('one key means one thing only', () => {
  assert.equal(answerOf('\r', false), 'blend', 'Enter follows the proposal');
  assert.equal(answerOf('\r', true), 'cutout');
  assert.equal(answerOf('d', false), 'cutout');
  assert.equal(answerOf('V', false), 'blend', 'case does not change the meaning');
  assert.equal(answerOf('?', true), 'help');
  assert.equal(answerOf('\u0003', true), 'quit');
  assert.equal(answerOf('z', true), null);
});

// Behaviour: what is written to disk and sent to terminals is a real PNG.
test('the written PNG is a PNG', () => {
  const png = encodePng(2, 2, new Uint8Array(16).fill(200));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});
