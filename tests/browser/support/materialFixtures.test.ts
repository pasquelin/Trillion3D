// The material fixtures declare glass for both engine renderers (#479): a surface that transmits
// is read on WebGL2 against WebGPU, within the window any value two engines quantise is held to.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtures } from './materialFixtures.ts';
import { WITNESS_PAIR } from './materialFixtureShape.ts';

// The map fixtures draw on a page canvas: only the fixtures WebGL2 reads are built here.
const glass = fixtures.filter((fixture) => fixture.pair?.includes('webgl2'));

test('the fixtures WebGL2 reads are world-built glass under the sun', () => {
  assert.ok(glass.length > 0, 'no fixture is read on WebGL2');
  for (const fixture of glass) {
    const surface = fixture.material();
    assert.equal(fixture.lit, true, `${fixture.name}: glass unlit, unlike #337's repro`);
    assert.equal(surface.transmission, 1);
    assert.equal(surface.ior, 1.5);
    const { thickness } = surface;
    assert.ok(
      typeof thickness === 'number' && thickness > 0,
      `${fixture.name}: a glass with no thickness`,
    );
    assert.notEqual(fixture.behind, undefined, `${fixture.name}: nothing behind to transmit`);
  }
});

test('glass is declared for both engine renderers, WebGL2 read against WebGPU', () => {
  for (const fixture of glass) assert.deepEqual(fixture.pair, ['webgpu', 'webgl2']);
});

test('glass is held to the window of two engines quantising one value', () => {
  const plain = fixtures.find((fixture) => fixture.name === 'base colour');
  assert.ok(plain);
  for (const fixture of glass) {
    assert.deepEqual(fixture.difference, plain.difference);
    assert.equal(fixture.reason, plain.reason);
  }
});

test('a fixture that names no pair is read against the witness', () => {
  assert.deepEqual(WITNESS_PAIR, ['witness', 'webgpu']);
  assert.ok(fixtures.filter((fixture) => !fixture.pair).length > 0);
});
