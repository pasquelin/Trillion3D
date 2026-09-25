// `world.effects` (#349): an ordered chain whose every change — a pass added, moved out, or one
// of its settings written — counts one revision and asks for a frame, and whose passes an engine
// reads per stage, in chain order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectChain } from './chain.ts';
import { effect } from './index.ts';

test('passes run in the order they were added, or at the index given', () => {
  const chain = new EffectChain();
  const first = effect.bloom(),
    second = effect.bloom(),
    third = effect.bloom();
  chain.add(first).add(third).add(second, 1);
  assert.deepEqual(chain.passes, [first, second, third]);
  assert.equal(chain.size, 3);
  assert.deepEqual(chain.stage('before-tone-mapping'), [first, second, third]);
  assert.deepEqual(chain.stage('after-tone-mapping'), [], 'bloom runs before tone mapping');
  assert.equal(chain.stage('before-tone-mapping'), chain.stage('before-tone-mapping'), 'kept');
});

test('every change counts one revision and asks for a frame; a setting reaches the chain', () => {
  let asked = 0;
  const chain = new EffectChain(() => void asked++);
  const bloom = effect.bloom();
  chain.add(bloom);
  bloom.intensity = 0.5;
  bloom.radius = 2;
  assert.equal(chain.remove(bloom), true);
  bloom.intensity = 0.2; // out of the chain: nothing to redraw
  assert.equal(chain.remove(bloom), false);
  chain.clear(); // already empty: no change
  assert.deepEqual([chain.revision, asked], [4, 4]);
  chain.add(bloom);
  chain.clear();
  assert.deepEqual([chain.size, chain.revision], [0, 6]);
  assert.deepEqual(chain.stage('before-tone-mapping'), [], 'the stage list follows the change');
});

test('a pass belongs to one chain; an index outside the chain and a foreign pass are refused', () => {
  const a = new EffectChain(),
    b = new EffectChain();
  const bloom = effect.bloom();
  a.add(bloom);
  assert.throws(() => b.add(bloom), /EFFECT_IN_A_CHAIN/);
  assert.throws(() => b.add(effect.bloom(), 1), /EFFECT_INDEX:1/);
  assert.throws(() => b.add({ kind: 'bloom' } as never), /EFFECT_UNKNOWN/);
  a.remove(bloom);
  b.add(bloom);
  assert.deepEqual([a.size, b.size], [0, 1]);
});

test('bloom takes the published defaults and refuses a blend outside [0, 1] or a spread of 0', () => {
  const bloom = effect.bloom();
  assert.deepEqual([bloom.intensity, bloom.radius], [0.04, 1], 'Jimenez 2014');
  assert.equal(bloom.stage, 'before-tone-mapping');
  assert.deepEqual([effect.bloom({ intensity: 1, radius: 3 }).radius], [3]);
  assert.throws(() => effect.bloom({ intensity: 1.5 }), /BLOOM_INTENSITY/);
  assert.throws(() => (bloom.intensity = Number.NaN), /BLOOM_INTENSITY/);
  assert.throws(() => (bloom.radius = 0), /BLOOM_RADIUS/);
  assert.throws(() => effect.bloom({ radius: Infinity }), /BLOOM_RADIUS/);
});
