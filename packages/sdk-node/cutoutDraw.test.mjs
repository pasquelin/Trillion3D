import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageKind, encodePng } from './cutoutDraw.mts';
import { answerOf } from './cutoutShow.mts';

// Comportement : chaque terminal reçoit ce qu'il sait afficher, et rien n'est deviné — la capacité
// se lit dans l'environnement, avec la mosaïque de blocs pour repli universel.
test('chaque terminal reçoit ce qu’il sait afficher', () => {
  assert.equal(imageKind({ TERM: 'xterm-kitty' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'WarpTerminal' }), 'kitty');
  assert.equal(imageKind({ TERM_PROGRAM: 'iTerm.app' }), 'iterm');
  assert.equal(imageKind({ TERM: 'xterm-256color' }), 'blocks');
  assert.equal(imageKind({}), 'blocks');
});

// Comportement : une touche dit une chose et une seule ; Entrée suit la proposition, et ce qui n'est
// pas une touche connue ne répond rien plutôt que de trancher au hasard.
test('une touche dit une chose et une seule', () => {
  assert.equal(answerOf('\r', false), 'blend', 'Entrée suit la proposition');
  assert.equal(answerOf('\r', true), 'cutout');
  assert.equal(answerOf('d', false), 'cutout');
  assert.equal(answerOf('V', false), 'blend', 'la casse ne change rien');
  assert.equal(answerOf('?', true), 'help');
  assert.equal(answerOf('', true), 'quit');
  assert.equal(answerOf('z', true), null);
});

// Comportement : ce qui est écrit sur le disque et envoyé aux terminaux est un vrai PNG.
test('le PNG écrit est un PNG', () => {
  const png = encodePng(2, 2, new Uint8Array(16).fill(200));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});
