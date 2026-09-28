/**
 * A lamp reaches only as far as the frame shows it (#958): shortening its range moves no displayed
 * colour by half an eight-bit step, at any exposure, under ACES or `linear`, whatever the other
 * lights put under it; and it never reaches farther than it did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { light } from './light.ts';
import { lampRecord } from './lightRecord.ts';
import { irradianceQuantum, visibleReach, type Display } from './lightReach.ts';

/** The display chain as the shaders run it (`lighting/toneMappingWgsl.ts`, `toneCurveConstants.ts`,
 *  the sRGB transfer of `webgl/core/outputGlsl.ts`), on the CPU: the oracle the bound is checked on. */
const IN = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const rows = (m: number[], v: number[]) =>
  [0, 3, 6].map((r) => m[r] * v[0] + m[r + 1] * v[1] + m[r + 2] * v[2]);
const fit = (c: number) =>
  (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.432951) + 0.238081);
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** 0.41666 - 0.055);
const curves = {
  aces: (c: number[]) =>
    rows(
      OUT,
      rows(
        IN,
        c.map((x) => x / 0.6),
      ).map(fit),
    ).map(clamp),
  linear: (c: number[]) => c.map(clamp),
};
const shown = (curve: keyof typeof curves, c: number[]) =>
  curves[curve](c).map((x) => srgb(x) * 255);

/** The range window of the shaders (`rangeWindow`), and a point's irradiance by a lamp of `peak`. */
const rangeWindow = (d: number, range: number) => clamp(1 - (d / range) ** 4) ** 2;
const irradiance = (peak: number, d: number, range: number) =>
  (peak * rangeWindow(d, range)) / Math.max(d * d, 1e-4);

/** A seeded draw in [0, 1): the same cases on every run. */
let seed = 7;
const draw = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

for (const toneMapping of ['aces', 'linear'] as const)
  for (const exposure of [1, 2, 4, 8])
    test(`no colour moves by 0.5 LSB past or within the reach, ${toneMapping} at exposure ${exposure}`, () => {
      const display: Display = { exposure, toneMapping };
      let worst = 0;
      for (let lamp = 0; lamp < 40; lamp++) {
        const peak = 10 ** (draw() * 6 - 2),
          range = 10 ** (draw() * 4 - 1);
        const colour = [draw(), draw(), draw()].map((c, i) => (i === lamp % 3 ? 1 : c));
        const reach = visibleReach(range, peak, irradianceQuantum(display));
        assert.ok(reach <= range);
        // What the other lights put under this one: black, the curves' steepest inputs, random.
        const bases = [
          [0, 0, 0],
          [0.0024, 0.0024, 0.0024],
          [0.15, 0.15, 0.15],
          [draw(), draw(), draw()],
        ];
        for (let step = 1; step <= 400; step++) {
          const d = (range * step) / 400;
          const before = irradiance(peak, d, range) * exposure,
            after = irradiance(peak, d, reach) * exposure;
          for (const base of bases) {
            const a = shown(
                toneMapping,
                base.map((b, i) => b + before * colour[i]),
              ),
              b = shown(
                toneMapping,
                base.map((b, i) => b + after * colour[i]),
              );
            for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
          }
        }
      }
      assert.ok(worst < 0.5, `the largest change is ${worst} LSB`);
    });

test('a raised exposure keeps a lamp farther, never farther than its range', () => {
  const reachAt = (exposure: number) =>
    visibleReach(100, 1, irradianceQuantum({ exposure, toneMapping: 'linear' }));
  const reaches = [1, 2, 4, 8].map(reachAt);
  for (let i = 1; i < reaches.length; i++) assert.ok(reaches[i] > reaches[i - 1]);
  assert.ok(reaches[0] < 75, 'a dim lamp in a wide range is cut by a quarter at least');
  assert.ok(reaches.every((reach) => reach < 100));
});

test('a display with no bound, or a light giving none, keeps the range', () => {
  const quantum = irradianceQuantum({ exposure: 1, toneMapping: 'aces' });
  for (const exposure of [0, -1, NaN, Infinity])
    assert.equal(irradianceQuantum({ exposure, toneMapping: 'aces' }), 0);
  assert.equal(irradianceQuantum({ exposure: 1, toneMapping: 'agx' }), 0, 'an unbounded curve');
  assert.equal(visibleReach(20, 100, 0), 20);
  assert.equal(visibleReach(20, 0, quantum), 20, 'zero intensity');
  assert.equal(visibleReach(20, NaN, quantum), 20);
  assert.equal(visibleReach(20, Infinity, quantum), 20);
  assert.ok(Number.isNaN(visibleReach(NaN, 100, quantum)), 'no range is made up');
  const endless = visibleReach(Infinity, 100, quantum);
  assert.ok(Number.isFinite(endless) && endless > 0, 'an infinite range gets a finite reach');
  assert.ok(Math.abs(visibleReach(1e7, 100, quantum) / endless - 1) < 1e-6, 'its limit');
});

test('a lamp record reaches as far as the display shows it, and holds its emitter', () => {
  const day: Display = { exposure: 1, toneMapping: 'aces' },
    night: Display = { exposure: 8, toneMapping: 'aces' };
  const lamp = light.point({ intensity: 0.01, distance: 30 });
  lamp.updateMatrixWorld();
  const short = lampRecord(lamp, 'a', 1, day)!.range!,
    long = lampRecord(lamp, 'a', 1, night)!.range!;
  assert.ok(short < long && long < 30, 'the exposure grows the reach back');
  assert.equal(lampRecord(lamp, 'a', 1, day)!.range, short, 'the same display, the same reach');
  const wide = light.point({ intensity: 0.01, distance: 30, radius: 29 });
  wide.updateMatrixWorld();
  const held = lampRecord(wide, 'b', 1, day)!;
  assert.deepEqual([held.range, held.emitterRadius], [30, 29], 'a bulb wider than its reach');
  assert.equal(lampRecord(light.point({ intensity: 0 }), 'c', 1, day), null);
});
