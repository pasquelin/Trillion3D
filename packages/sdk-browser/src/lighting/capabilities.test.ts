import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingCapabilitiesOf } from './capabilities.ts';
import type { RenderBackend } from '../backend/types.ts';

/** An engine reduced to the methods the capability reads: nothing else enters the answer. */
const backendOf = (parts: Partial<RenderBackend>) => ({ id: 'moteur', ...parts }) as RenderBackend;

test('an engine that does not reread the store declares no lighting capability', () => {
  const capabilities = lightingCapabilitiesOf(backendOf({}));
  assert.deepEqual(
    { ...capabilities, reason: undefined },
    {
      sceneLights: false,
      lightingView: false,
      shadows: false,
      transforms: false,
      reason: undefined,
    },
  );
  // The refusal is named: that is what the host reads instead of inferring a fault from a black frame.
  assert.match(capabilities.reason!, /moteur/);
});

test('an engine that rereads the store applies lights and view, and its shadows declare themselves', () => {
  const sansOmbre = lightingCapabilitiesOf(
    backendOf({ refreshSceneLights: () => {}, lighting: { shadows: false, reason: 'no shadow' } }),
  );
  assert.deepEqual(sansOmbre, {
    sceneLights: true,
    lightingView: true,
    shadows: false,
    transforms: false,
    reason: 'no shadow',
  });
  const avecOmbre = lightingCapabilitiesOf(
    backendOf({
      refreshSceneLights: () => {},
      setTransform: () => {},
      lighting: { shadows: true },
    }),
  );
  assert.deepEqual(avecOmbre, {
    sceneLights: true,
    lightingView: true,
    shadows: true,
    transforms: true,
  });
});

test('a shadow declaration is worthless without rereading the store', () => {
  const capabilities = lightingCapabilitiesOf(backendOf({ lighting: { shadows: true } }));
  assert.equal(capabilities.shadows, false);
});

test('node movement is read from the method, never from a declaration', () => {
  assert.equal(lightingCapabilitiesOf(backendOf({ setTransform: () => {} })).transforms, true);
});
