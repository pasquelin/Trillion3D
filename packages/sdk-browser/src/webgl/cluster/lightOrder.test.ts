import test from 'node:test';
import assert from 'node:assert/strict';
import { inReferenceOrder } from './lightOrder.ts';

/** A light of one kind, named by `name`, casting a shadow or not. */
const light = (name: string, kind: 'point' | 'spot' | 'sun' | 'rect', castShadow = false) => ({
  name,
  castShadow,
  isLight: true,
  isPointLight: kind === 'point',
  isSpotLight: kind === 'spot',
  isDirectionalLight: kind === 'sun',
  isRectAreaLight: kind === 'rect',
});

// Issue #275: the reference files its lights after a stable sort that puts the shadow casters
// first; within a kind the engine's program writes them in that same order.
test('the direct lights are filed by kind, the shadow casters first within a kind', () => {
  const lights = [
    light('sun-a', 'sun'),
    light('point-a', 'point'),
    light('sun-b', 'sun', true),
    light('point-b', 'point', true),
    light('rect-a', 'rect'),
    light('spot-a', 'spot'),
    light('point-c', 'point'),
    light('spot-b', 'spot', true),
  ];
  const order: string[] = [];
  inReferenceOrder(lights, (visited) => order.push(visited.name));
  assert.deepEqual(order, [
    'point-b',
    'point-a',
    'point-c',
    'spot-b',
    'spot-a',
    'sun-b',
    'sun-a',
    'rect-a',
  ]);
});
