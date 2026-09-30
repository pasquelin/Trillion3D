import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../world/geometry/geometry.ts';
import { BufferAttribute } from '../world/buffer/attribute.ts';
import { softBodyOf, softOf, isSoftType } from './soft.ts';
import { softSettings } from './softSettings.ts';

const geometry = (values: number[], index?: number[]) => {
  const value = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array(values), 3),
  );
  if (index) value.setIndex(index);
  return value;
};
const one = { x: 1, y: 1, z: 1 };
test('soft bodies distinguish rigid options and ropes while respecting minimal valid geometry', () => {
  assert.equal(isSoftType('rope'), true);
  assert.equal(isSoftType('dynamic'), false);
  assert.equal(softOf('dynamic'), null);
  assert.equal(softOf({ type: 'dynamic' }), null);
  assert.equal(softOf({ type: 'rope' })?.type, 'rope');
  const rope = softBodyOf(
    geometry([0, 0, 0, 0, 0, 2]),
    one,
    softSettings({ type: 'rope', mass: 4 }),
  );
  assert.deepEqual([...rope.vertices], [0, 0, 0, 2, 0, 0, 2, 2]);
  assert.equal(rope.indices.length, 0);
  assert.equal(rope.pressure, 0);
  const longer = softBodyOf(
    geometry([0, 0, 0, 1, 0, 0, 1, 2, 0]),
    one,
    softSettings({ type: 'rope' }),
  );
  assert.equal(longer.indices.length, 0);
  for (const type of ['rope', 'cloth'] as const)
    assert.throws(
      () => softBodyOf(geometry([0, 0, 0]), one, softSettings({ type })),
      (error: any) => error.code === 'PHYSICS_FAILED' && error.message.includes(type),
    );
});

test('welding removes every degenerate index pattern without removing a valid neighboring face', () => {
  const value = geometry([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 2]);
  const cloth = softBodyOf(value, one, softSettings({ type: 'cloth', mass: 9 }));
  assert.deepEqual([...cloth.indices], [0, 1, 2]);
  assert.deepEqual([...cloth.vertices], [0, 0, 0, 3, 2, 0, 0, 3, 0, 3, 0, 3]);
  const collinear = geometry([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  assert.throws(
    () => softBodyOf(collinear, one, softSettings({ type: 'cloth' })),
    (error: any) => error.code === 'PHYSICS_FAILED' && error.message.includes('area or length'),
  );
  for (const pin of [-1, 0.5, NaN, 3])
    assert.throws(
      () => softBodyOf(value, one, softSettings({ type: 'cloth', pins: [pin] })),
      (error: any) => error instanceof RangeError && error.message.includes('pin'),
    );
});

test('incomplete trailing triangle corners do not enter cloth connectivity', () => {
  const value = geometry([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 1, 2, 0, 1]);
  assert.deepEqual([...softBodyOf(value, one, softSettings({ type: 'cloth' })).indices], [0, 1, 2]);
  assert.throws(
    () => softBodyOf(value, one, softSettings({ type: 'volume', pressure: 1e10 })),
    /pressure.*Pa.*skin holds/,
  );
});

test('cloth with distinct vertices but no nondegenerate faces is refused', () => {
  const value = geometry([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 0, 1]);
  assert.throws(
    () => softBodyOf(value, one, softSettings({ type: 'cloth' })),
    /needs more vertices/,
  );
});

test('invalid soft options identify the rejected property and value', () => {
  for (const name of ['shape', 'sensor', 'ccd', 'decorative']) {
    assert.throws(
      () => softSettings({ type: 'cloth', [name]: false } as never),
      new RegExp(`no ${name}`),
    );
  }
  assert.throws(
    () => softSettings({ type: 'cloth', damping: { angular: 0.1 } } as never),
    /angular damping/,
  );
  assert.throws(() => softSettings({ type: 'cloth', mass: -2 }), /mass.*-2/);
});

test('direct cloth settings cannot give an open surface gas pressure', () => {
  const value = geometry([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  const settings = softSettings({ type: 'cloth' });
  settings.pressure = 1;
  assert.throws(() => softBodyOf(value, one, settings), /pressure/);
});
