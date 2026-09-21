import test from 'node:test';
import assert from 'node:assert/strict';
import { textureLevelFormat, textureLevelUrl } from './textureLevelUrl.ts';

const SHA = 'ab'.repeat(32);
const TEMPLATE = '../../textures/{sha}/{kind}-{level}.{format}';

test('a baked level is addressed by digest, atlas, rank and format, from the manifest template', () => {
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 0, 3, 'png'), `../../textures/${SHA}/srgb-3.png`);
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 1, 0, 'bc7'), `../../textures/${SHA}/linear-0.bc7`);
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 0, 2, 'astc'), `../../textures/${SHA}/srgb-2.astc`);
});

// Behaviour: the file a chain's layout names in the family a session samples — the lossless one
// with no family, or where the gate left the chain lossless; the two-channel codec of a normal map.
test('the level format follows the family and the layout, lossless when either says so', () => {
  assert.equal(textureLevelFormat(undefined, 'rgba'), 'png');
  assert.equal(textureLevelFormat('bc7', 'lossless'), 'png');
  assert.equal(textureLevelFormat('bc7', 'rgba'), 'bc7');
  assert.equal(textureLevelFormat('bc7', 'two-channel'), 'bc5');
  assert.equal(textureLevelFormat('astc', 'rgba'), 'astc');
  assert.equal(textureLevelFormat('astc', 'two-channel'), 'astc-la');
});

test('an unknown atlas, an invalid digest or rank, a template without a field are rejected', () => {
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 2, 0, 'png'), /unknown atlas/);
  assert.throws(() => textureLevelUrl(TEMPLATE, 'abc', 0, 0, 'png'), /invalid address/);
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, -1, 'png'), /invalid address/);
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, 1.5, 'png'), /invalid address/);
  assert.throws(
    () => textureLevelUrl('../../textures/{sha}.png', SHA, 0, 0, 'png'),
    /lacks a field/,
  );
  // The template of the previous section, without the format field, serves nothing.
  assert.throws(
    () => textureLevelUrl('../../textures/{sha}/{kind}-{level}.png', SHA, 0, 0, 'bc7'),
    /lacks a field/,
  );
});
