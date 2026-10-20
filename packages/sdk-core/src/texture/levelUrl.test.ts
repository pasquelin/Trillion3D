import test from 'node:test'
import assert from 'node:assert/strict'
import { textureLevelFormat, textureLevelUrl } from './levelUrl.ts'

const SHA = 'ab'.repeat(32)
const TEMPLATE = '../../textures/{sha}/{kind}-{level}.{format}'

test('a baked level is addressed by digest, atlas, rank and format, from the manifest template', () => {
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 0, 3, 'etc2'), `../../textures/${SHA}/srgb-3.etc2`)
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 1, 0, 'bc7'), `../../textures/${SHA}/linear-0.bc7`)
  assert.equal(textureLevelUrl(TEMPLATE, SHA, 0, 2, 'astc'), `../../textures/${SHA}/srgb-2.astc`)
  // The chain weighted by coverage is another file than the plain one of the same image.
  assert.equal(
    textureLevelUrl(TEMPLATE, SHA, 2, 3, 'bc7'),
    `../../textures/${SHA}/srgb-coverage-3.bc7`,
  )
  // A coverage chain cut at byte 128 keeps its share of covered texels: its own files.
  assert.equal(
    textureLevelUrl(TEMPLATE, SHA, (128 << 8) | 2, 3, 'bc7'),
    `../../textures/${SHA}/srgb-coverage-128-3.bc7`,
  )
})

// Behaviour: the file a chain's layout names in a family — the two-channel codec of a normal map;
// a family that holds nothing of the chain names no file.
test('the level format follows the family and the layout, none where the family holds nothing', () => {
  assert.throws(() => textureLevelFormat('astc', 'lossless'), /holds no chain/)
  assert.equal(textureLevelFormat('bc7', 'rgba'), 'bc7')
  assert.equal(textureLevelFormat('bc7', 'two-channel'), 'bc5')
  assert.equal(textureLevelFormat('astc', 'rgba'), 'astc')
  assert.equal(textureLevelFormat('astc', 'two-channel'), 'astc-la')
})

test('an unknown atlas, an invalid digest or rank, a template without a field are rejected', () => {
  for (const atlas of [3, (128 << 8) | 0, (128 << 8) | 1, 256 << 8, 2 ** 32 + 2, -1, 2.5])
    assert.throws(() => textureLevelUrl(TEMPLATE, SHA, atlas, 0, 'bc7'), /unknown atlas/)
  assert.throws(() => textureLevelUrl(TEMPLATE, 'abc', 0, 0, 'bc7'), /invalid address/)
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, -1, 'bc7'), /invalid address/)
  assert.throws(() => textureLevelUrl(TEMPLATE, SHA, 0, 1.5, 'bc7'), /invalid address/)
  assert.throws(
    () => textureLevelUrl('../../textures/{sha}.png', SHA, 0, 0, 'bc7'),
    /lacks a field/,
  )
  // The template of the previous section, without the format field, serves nothing.
  assert.throws(
    () => textureLevelUrl('../../textures/{sha}/{kind}-{level}.png', SHA, 0, 0, 'bc7'),
    /lacks a field/,
  )
})
