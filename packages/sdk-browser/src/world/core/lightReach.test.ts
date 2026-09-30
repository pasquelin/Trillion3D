/**
 * A lamp reaches no farther than the frame's perceptible threshold, and never past its authored
 * range (#958, CMP-16): the frame shortens it to the reach the audit's exposure- and curve-aware
 * cut makes visible, accepting a declared class-2 change the acceptance session holds to the human
 * eye. The reach is re-derived whenever the exposure or the light changes, so a fade never steps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { boundReach, perceptibleQuantum, visibleReach } from './lightReach.ts';

test('the quantum is the audit floor at ACES and exposure 1, and follows exposure and curve', () => {
  const reference = perceptibleQuantum({ exposure: 1, toneMapping: 'aces' });
  assert.ok(Math.abs(reference - 1e-2) < 1e-12, `the audit's 0.01 W/m²: ${reference}`);
  for (const exposure of [2, 4, 8])
    assert.ok(
      Math.abs(perceptibleQuantum({ exposure, toneMapping: 'aces' }) - 1e-2 / exposure) < 1e-12,
      `exposure ${exposure} halves the floor`,
    );
  assert.equal(
    perceptibleQuantum({ exposure: 2, toneMapping: 'linear' }),
    perceptibleQuantum({ exposure: 2, toneMapping: 'aces' }) / 3.334,
    'a flatter curve cuts no deeper than the steeper one',
  );
  for (const exposure of [0, -1, NaN, Infinity])
    assert.equal(perceptibleQuantum({ exposure, toneMapping: 'aces' }), 0, `${exposure}`);
  assert.equal(perceptibleQuantum({ exposure: 1, toneMapping: 'agx' }), 0, 'an unbounded curve');
});

test('a raised exposure keeps a lamp farther at once, never farther than its range', () => {
  const quantumAt = (exposure: number) => perceptibleQuantum({ exposure, toneMapping: 'aces' });
  const reachAt = (exposure: number) => visibleReach(100, quantumAt(1) * 1e4, quantumAt(exposure));
  const reaches = [1, 2, 4, 8].map(reachAt);
  for (let i = 1; i < reaches.length; i++) assert.ok(reaches[i] > reaches[i - 1]);
  assert.ok(reaches.every((reach) => reach < 100));
  // Re-derived on every exposure change, not once per half stop: a fade never steps the edge.
  assert.notEqual(reachAt(1.2), reachAt(1.4), 'a quarter stop longer is a longer reach');
  assert.ok(reachAt(1.4) > reachAt(1.2));
});

test('a display with no bound, or a light giving none, keeps the range', () => {
  const quantum = perceptibleQuantum({ exposure: 1, toneMapping: 'aces' });
  assert.equal(visibleReach(20, 1, 0), 20);
  assert.equal(visibleReach(20, 0, quantum), 20, 'zero intensity');
  assert.equal(visibleReach(20, NaN, quantum), 20);
  const endless = visibleReach(Infinity, 1, quantum);
  assert.ok(Number.isFinite(endless) && endless > 0, 'an infinite range gets a finite reach');
  assert.ok(Math.abs(visibleReach(endless * 1e3, 1, quantum) / endless - 1) < 1e-6, 'its limit');
});

test('a record keeps a range its emitter needs, and a rectangle its own', () => {
  const quantum = perceptibleQuantum({ exposure: 1, toneMapping: 'aces' });
  const lamp = (extra: Partial<SceneLight>): SceneLight => ({
    id: 'a',
    kind: 'point',
    color: [1, 0.5, 0.2],
    intensity: quantum * 900,
    castsShadow: false,
    position: [0, 0, 0],
    range: 30,
    ...extra,
  });
  const free = lamp({});
  boundReach(free, quantum);
  assert.ok(free.range! < 30);
  const wide = lamp({ emitterRadius: 29 });
  boundReach(wide, quantum);
  assert.equal(wide.range, 30, 'a bulb wider than its reach');
  const panel = lamp({ kind: 'rect' });
  boundReach(panel, quantum);
  assert.equal(panel.range, 30);
});
