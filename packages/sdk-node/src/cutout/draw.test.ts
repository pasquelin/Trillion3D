import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageKind } from './draw.mts';
import { encodePng } from './png.mts';

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

// Behaviour: what is written to disk and sent to terminals is a real PNG.
test('the written PNG is a PNG', () => {
  const png = encodePng(2, 2, new Uint8Array(16).fill(200));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});
