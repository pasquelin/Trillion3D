import test from 'node:test';
import assert from 'node:assert/strict';
import { light, Light } from './light.ts';
import { Object3D } from '../object/object3d.ts';

test('light factories preserve their kinds, default aim and explicit zero-valued parameters', () => {
  for (const [kind, create] of Object.entries(light)) {
    const node = create();
    assert.equal(node.kind, kind);
    assert.equal(node.type, `${kind}Light`);
    assert.equal(node.decay, 2);
    assert.equal(node.angle, Math.PI / 3);
    assert.equal(node.castShadow, false);
    assert.deepEqual(
      node.position.toArray(),
      ['spot', 'directional', 'hemisphere'].includes(kind) ? [0, 1, 0] : [0, 0, 0],
    );
    assert.equal(create({ castShadow: true }).castShadow, true);
    const zero = create({ position: [0, 0, 0], decay: 0, angle: 0, intensity: 0 });
    assert.equal(zero.decay, 0);
    assert.equal(zero.angle, 0);
    assert.equal(zero.intensity, 0);
    assert.deepEqual(zero.position.toArray(), [0, 0, 0]);
  }
});

test('cloning a light preserves values but owns independently editable coefficients and numbers', () => {
  const coefficients = Float64Array.from({ length: 27 }, (_, i) => i / 10);
  const source = new Light('spot', {
    color: [0.2, 0.4, 0.6],
    groundColor: [0.1, 0.3, 0.5],
    sh: coefficients,
    target: [4, 5, 6],
    decay: 1.5,
    intensity: 7,
    distance: 8,
    angle: 0.3,
    penumbra: 0.4,
    width: 2,
    height: 3,
    radius: 0.2,
  });
  coefficients[0] = 99;
  const clone = source.clone();
  assert.equal(clone.kind, 'spot');
  assert.deepEqual(
    clone.sh,
    Array.from({ length: 27 }, (_, i) => i / 10),
  );
  assert.notEqual(clone.sh, source.sh);
  assert.deepEqual(clone.color.toArray(), [0.2, 0.4, 0.6]);
  assert.deepEqual(clone.groundColor.toArray(), [0.1, 0.3, 0.5]);
  assert.deepEqual(clone.target.position.toArray(), [4, 5, 6]);
  assert.deepEqual(
    [
      clone.decay,
      clone.intensity,
      clone.distance,
      clone.angle,
      clone.penumbra,
      clone.width,
      clone.height,
      clone.radius,
    ],
    [1.5, 7, 8, 0.3, 0.4, 2, 3, 0.2],
  );
  clone.intensity = 20;
  clone.sh![1] = 30;
  clone.target.position.x = 40;
  assert.equal(source.intensity, 7);
  assert.equal(source.sh![1], 0.1);
  assert.equal(source.target.position.x, 4);
  assert.equal(clone.copy(new Light('point')).sh, null);
  assert.equal(clone.kind, 'spot');
});

test('copying an ordinary node preserves light-specific values while adopting its pose', () => {
  const lamp = new Light('point', { intensity: 4 });
  const source = new Object3D();
  source.position.set(3, 2, 1);
  assert.equal(lamp.copy(source), lamp);
  assert.deepEqual(lamp.position.toArray(), [3, 2, 1]);
  assert.equal(lamp.intensity, 4);
});
