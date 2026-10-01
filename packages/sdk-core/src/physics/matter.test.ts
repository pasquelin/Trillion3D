import test from 'node:test';
import assert from 'node:assert/strict';
import { Material } from '../world/material/material.ts';
import { physicsMatterOf } from './matter.ts';
import { DEFAULT_MATTER, PHYSICS_MATERIALS } from './options.ts';

test('a material that says nothing is the default matter', () => {
  assert.deepEqual(physicsMatterOf(new Material('meshStandard')), DEFAULT_MATTER);
  assert.deepEqual(physicsMatterOf([]), DEFAULT_MATTER, 'no material at all');
});

test('a material preset gives the matter, and the material’s own fields win over it', () => {
  const { rubber, metal } = PHYSICS_MATERIALS;
  assert.deepEqual(physicsMatterOf(new Material('meshStandard', { physics: 'rubber' })), rubber);
  assert.deepEqual(
    physicsMatterOf(new Material('meshStandard', { physics: 'rubber', friction: 0.2 })),
    { ...rubber, friction: 0.2 },
  );
  assert.deepEqual(
    physicsMatterOf(new Material('meshStandard', { density: 5, restitution: 0 })),
    { ...DEFAULT_MATTER, density: 5, restitution: 0 },
    'over the default, a 0 kept',
  );
  // A mesh of several materials is the first's matter.
  const first = new Material('meshStandard', { physics: 'metal' });
  assert.deepEqual(
    physicsMatterOf([first, new Material('meshStandard', { physics: 'rubber' })]),
    metal,
  );
});
