import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from './color.ts';

// Independent CSS Color 4 named-color references in functional sRGB notation:
// https://www.w3.org/TR/css-color-4/#named-colors
// Exercise names as page input, then serialize and perform linear-space operations.
const palettes: Record<string, [string, string][]> = {
  neutral: [
    ['aliceblue', 'rgb(240 248 255)'],
    ['darkgray', 'rgb(169 169 169)'],
    ['gray', 'rgb(128 128 128)'],
    ['lightgray', 'rgb(211 211 211)'],
    ['silver', 'rgb(192 192 192)'],
    ['snow', 'rgb(255 250 250)'],
  ],
  warm: [
    ['blanchedalmond', 'rgb(255 235 205)'],
    ['darkorange', 'rgb(255 140 0)'],
    ['gold', 'rgb(255 215 0)'],
    ['lemonchiffon', 'rgb(255 250 205)'],
    ['lightpink', 'rgb(255 182 193)'],
    ['papayawhip', 'rgb(255 239 213)'],
    ['salmon', 'rgb(250 128 114)'],
    ['tomato', 'rgb(255 99 71)'],
  ],
  cool: [
    ['chartreuse', 'rgb(127 255 0)'],
    ['cornflowerblue', 'rgb(100 149 237)'],
    ['darkslateblue', 'rgb(72 61 139)'],
    ['deepskyblue', 'rgb(0 191 255)'],
    ['dodgerblue', 'rgb(30 144 255)'],
    ['indigo', 'rgb(75 0 130)'],
    ['lightcyan', 'rgb(224 255 255)'],
    ['lightsteelblue', 'rgb(176 196 222)'],
    ['limegreen', 'rgb(50 205 50)'],
    ['mediumpurple', 'rgb(147 112 219)'],
    ['mediumspringgreen', 'rgb(0 250 154)'],
    ['midnightblue', 'rgb(25 25 112)'],
    ['olive', 'rgb(128 128 0)'],
    ['palegreen', 'rgb(152 251 152)'],
    ['rebeccapurple', 'rgb(102 51 153)'],
    ['yellowgreen', 'rgb(154 205 50)'],
  ],
};

for (const [family, palette] of Object.entries(palettes))
  test(`CSS ${family} names accept case and whitespace and use the same working space as rgb()`, () => {
    for (const [name, css] of palette) {
      const named = new Color(` \t${name.toUpperCase()}\n`),
        reference = new Color(css);
      assert.deepEqual(named.toArray(), reference.toArray(), name);
      assert.equal(new Color(named.getStyle()).getHex(), reference.getHex(), name);
      named.multiplyScalar(0.5);
      reference.multiplyScalar(0.5);
      assert.deepEqual(named.toArray(), reference.toArray(), `${name}: linear exposure`);
      assert.equal(named.getHex(), reference.getHex());
    }
  });

test('CSS spelling aliases survive repeated use and unknown names do not change the prior color', () => {
  const value = new Color('rebeccapurple');
  for (const name of [
    'gray',
    'darkgray',
    'dimgray',
    'lightgray',
    'slategray',
    'darkslategray',
    'lightslategray',
  ]) {
    assert.equal(value.setStyle(name), value);
    const before = value.toArray();
    value.setStyle(name.replace('gray', 'grey').toUpperCase());
    assert.deepEqual(value.toArray(), before);
  }
  for (const [a, b] of [
    ['aqua', 'cyan'],
    ['fuchsia', 'magenta'],
  ])
    assert.deepEqual(new Color(a).toArray(), new Color(b).toArray());
  const previous = value.toArray();
  assert.throws(() => value.setStyle('not-a-css-color'), /Unknown colour/);
  assert.deepEqual(value.toArray(), previous);
});
