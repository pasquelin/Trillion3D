// #360, #361: the anisotropy cost fixture reads English options; a page error fails it in
// `withRepoPage` (`tests/kit/server/repoPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { anisotropyOptions } from './anisotropyCost.ts';

test('the fixture reads its options in English, and checks them', () => {
  const options = anisotropyOptions(['--anisotropy', '1,4', '--width', '640', '--height', '360']);
  assert.deepEqual(options.anisotropies, [1, 4]);
  assert.deepEqual(options.size, [640, 360]);
  assert.equal(options.frames, 240);
  assert.throws(() => anisotropyOptions(['--anisotropy', '32']), /--anisotropy takes integers/);
  assert.throws(() => anisotropyOptions(['--width', '0']), /--width must be a positive integer/);
});
