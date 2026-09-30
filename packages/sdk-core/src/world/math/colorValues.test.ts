import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from './color.ts';
import { clearValueOf, rgbHex } from './packedColour.ts';
import { listen } from './observed.ts';

test('CSS and packed sRGB colors retain channel identity through linear storage and display', () => {
  for (const [style, hex] of [
    [' #f80 ', 0xff8800],
    ['#12AbEf', 0x12abef],
    ['rgb(255, 136, 0)', 0xff8800],
    ['RGB(100% 0% 0%)', 0xff0000],
    ['rgba(0, 255, 0, 0.5)', 0x00ff00],
    ['hsl(240, 100%, 50%)', 0x0000ff],
    ['hsla(120,100,50,1)', 0x00ff00],
    ['red', 0xff0000],
    ['RebeccaPurple', 0x663399],
  ] as const) {
    const color = new Color(style);
    assert.equal(color.getHex(), hex, style);
    assert.equal(new Color(color.getStyle()).getHex(), hex, style);
    assert.equal(color.getHexString(), color.getStyle().slice(1));
  }
  const bytes = clearValueOf(0x123456);
  assert.deepEqual(bytes, { r: 18 / 255, g: 52 / 255, b: 86 / 255, a: 1 });
  assert.equal(rgbHex(1, 2, 15), '#01020f');
  const gray = new Color(0x808080);
  assert.ok(Math.abs(gray.r - 0.21586050011389926) < 1e-12);
  assert.equal(gray.getHex(), 0x808080);
  assert.throws(() => new Color('unknown-color'), /Unknown colour: unknown-color/);
});

test('linear color edits notify owners and cloning does not alias mutable channels', () => {
  const color = new Color();
  assert.deepEqual(color.toArray(), [1, 1, 1]);
  let writes = 0;
  listen(color, () => writes++);
  color.set([0.1, 0.2, 0.3]);
  assert.deepEqual(color.toArray(), [0.1, 0.2, 0.3]);
  color.set({ r: 0.4, g: 0.5, b: 0.6 });
  assert.deepEqual(color.toArray(), [0.4, 0.5, 0.6]);
  color.fromArray([91, 0.2, 0.4, 0.6, 92], 1);
  assert.deepEqual(color.toArray(), [0.2, 0.4, 0.6]);
  assert.equal(writes, 3);
  const clone = color.clone();
  assert.ok(clone.equals(color));
  assert.deepEqual(clone.multiplyScalar(2).toArray(), [0.4, 0.8, 1.2]);
  assert.deepEqual(color.toArray(), [0.2, 0.4, 0.6]);
  assert.deepEqual(
    color.lerp({ r: 0.6, g: 0.8, b: 1 }, 0.5).toArray(),
    [0.4, 0.6000000000000001, 0.8],
  );
  color.setScalar(0.5);
  assert.deepEqual(color.toArray(), [0.5, 0.5, 0.5]);
  for (const other of [
    { r: 0, g: 0.5, b: 0.5 },
    { r: 0.5, g: 0, b: 0.5 },
    { r: 0.5, g: 0.5, b: 0 },
  ])
    assert.equal(color.equals(other), false);
  assert.deepEqual(new Color().setHSL(0, 1, 0.5).toArray(), [1, 0, 0]);
  assert.deepEqual(color.copy({ r: 1, g: 0, b: 1 }).toArray(), [1, 0, 1]);
});
