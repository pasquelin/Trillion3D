import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { lightFromRecord, lampRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { LoadedModel, type ModelRecord } from './loadedModel.ts';

// The radiometric records produced by the FBX fixture's transformed light instances.
const records: SceneLight[] = [
  {
    id: 'point',
    kind: 'point',
    castsShadow: false,
    position: [13, 22, 29],
    color: [1, 0.5, 0.25],
    intensity: 2000 / (4 * Math.PI * 683),
  },
  {
    id: 'point#2',
    kind: 'point',
    castsShadow: false,
    position: [12, 20, 31],
    color: [1, 0.5, 0.25],
    intensity: 2000 / (4 * Math.PI * 683),
  },
  {
    id: 'spot',
    kind: 'spot',
    castsShadow: false,
    position: [10, 21, 30],
    direction: [0, -1, 0],
    color: [0.25, 0.5, 1],
    intensity: 1500 / (4 * Math.PI * 683),
    coneAngle: Math.PI / 6,
  },
];
function loaded() {
  const source = new Object3D();
  for (const record of records) source.add(lightFromRecord(record));
  const model = new LoadedModel({ scene: { source } } as ModelRecord);
  for (const record of records) {
    const lamp = lightFromRecord(record);
    model._addFromFile(lamp, lamp.target);
  }
  return model;
}

test('imported lights keep their identity when found by name, edited and removed', () => {
  const model = loaded();
  const lamps = model.lights;
  assert.equal(lamps.length, 3);
  for (const lamp of lamps) {
    assert.ok(model.getObjectByName(lamp.name) === lamp);
    assert.ok(model.lights.includes(lamp));
    assert.equal(model._fromFile(lamp), true);
  }
  assert.notEqual(lamps[0], lamps[1], 'instances have distinct editable identities');
  lamps[0].intensity = 3;
  assert.equal(model.lights[0].intensity, 3);
  assert.equal(lamps[1].intensity, records[1].intensity);
  model.remove(lamps[0]);
  assert.equal(model.lights.length, 2);
  assert.equal(model.lights.includes(lamps[0]), false);
});

test('moving and rotating a loaded model transforms its lamps and targets together', () => {
  const model = loaded();
  model.position.set(1, 2, 3);
  model.rotation.set(0, 0, Math.PI / 2);
  const point = lampRecord(model.lights[0], 'point', 100)!;
  const spot = lampRecord(model.lights[2], 'spot', 100)!;
  const close = (actual: number[] | undefined, expected: number[]) => {
    assert.ok(actual);
    expected.forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-10));
  };
  close(point.position, [-21, 15, 32]);
  close(spot.position, [-20, 12, 33]);
  close(spot.direction, [1, 0, 0]);
  assert.deepEqual(spot.color, records[2].color);
  assert.equal(spot.coneAngle, Math.PI / 6);
  assert.equal(spot.intensity, records[2].intensity);
});
