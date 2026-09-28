/**
 * A lamp reaches only as far as the frame shows it (#958): shortening its range moves no displayed
 * colour by half an eight-bit step, at any exposure, under ACES or `linear`, on the smoothest
 * surface the engine shades, whatever the other lights put under it; and it never reaches farther
 * than it did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';
import {
  BRDF_PEAK,
  boundReach,
  irradianceQuantum,
  visibleReach,
  type Display,
} from './lightReach.ts';

/** The display chain as the shaders run it, on the CPU: the ACES matrices and fit of
 *  `lighting/toneCurveConstants.ts` (held there as shader text), row by row, and the sRGB
 *  transfer at the shaders' exponent 0.41666 (`webgl/core/outputGlsl.ts`). */
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

/** The specular lobe of `webgl/cluster/shaders.ts` (`specularLobe`, `fresnel`) times `N·L`, with
 *  `f0` at one, at the roughness floor, for the cosines `nl`, `nv`, `nh`, `vh`. */
const alpha = Number(ROUGHNESS_FLOOR) ** 2,
  a2 = alpha * alpha;
const lobe = (nl: number, nv: number, nh: number, vh: number) => {
  const gv = nl * Math.sqrt(a2 + (1 - a2) * nv * nv),
    gl = nv * Math.sqrt(a2 + (1 - a2) * nl * nl);
  const d = nh * nh * (a2 - 1) + 1;
  const fresnel = 1; // f0 at one: exp2's term only blends toward one
  return fresnel * (0.5 / Math.max(gv + gl, 1e-6)) * (a2 / (Math.PI * d * d)) * nl;
};
/** The lobe on the mirror direction (`H = N`, `N·L = N·V = V·H`), sampled down to grazing. */
const mirror = Array.from({ length: 2000 }, (_, i) => {
  const c = 10 ** (-6 + (6 * i) / 1999);
  return lobe(c, c, 1, c);
});
const steepest = 1 / Math.PI + Math.max(...mirror);

/** The range window of the shaders (`rangeWindow`), and a point's irradiance by a lamp of `peak`. */
const rangeWindow = (d: number, range: number) => clamp(1 - (d / range) ** 4) ** 2;
const irradiance = (peak: number, d: number, range: number) =>
  (peak * rangeWindow(d, range)) / Math.max(d * d, 1e-4);

/** A seeded draw in [0, 1): the same cases on every run. */
let seed = 7;
const draw = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('the brightest the smoothest surface gives back is under the bound the reach uses', () => {
  assert.ok(steepest <= BRDF_PEAK);
  assert.ok(steepest > BRDF_PEAK / 4, 'and the bound is not loose by more than four');
  // The bound holds for any four cosines, even ones no geometry joins.
  for (let i = 0; i < 20000; i++) {
    const [nl, nv, nh, vh] = [draw(), draw() ** 8, 1 - draw() ** 8, draw()];
    assert.ok(lobe(nl, nv, nh, vh) <= BRDF_PEAK - 1 / Math.PI);
  }
});

for (const toneMapping of ['aces', 'linear'] as const)
  for (const exposure of [1, 2, 4, 8])
    test(`no colour moves by 0.5 LSB at minimum roughness, ${toneMapping} at exposure ${exposure}`, () => {
      const display: Display = { exposure, toneMapping };
      const quantum = irradianceQuantum(display);
      let worst = 0,
        shortened = 0;
      for (let lamp = 0; lamp < 40; lamp++) {
        const range = 10 ** (draw() * 4 - 1);
        // Lamps around the one the quantum starts to shorten, from barely to deeply.
        const peak = quantum * range * range * 10 ** (draw() * 4 - 3);
        const colour = [draw(), draw(), draw()].map((c, i) => (i === lamp % 3 ? 1 : c));
        const reach = visibleReach(range, peak, quantum);
        assert.ok(reach <= range);
        if (reach < range * 0.99) shortened++;
        // What the other lights put under this one: black, the curves' steepest inputs, random.
        const bases = [
          [0, 0, 0],
          [0.0024, 0.0024, 0.0024],
          [0.15, 0.15, 0.15],
          [draw(), draw(), draw()],
        ];
        for (let step = 1; step <= 400; step++) {
          const d = (range * step) / 400;
          const gain = steepest * exposure;
          const before = irradiance(peak, d, range) * gain,
            after = irradiance(peak, d, reach) * gain;
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
      assert.ok(shortened > 10, 'the cases do shorten');
      assert.ok(worst < 0.5, `the largest change is ${worst} LSB`);
    });

test('a raised exposure keeps a lamp farther, never farther than its range', () => {
  const day = irradianceQuantum({ exposure: 1, toneMapping: 'linear' });
  const reachAt = (exposure: number) =>
    visibleReach(100, day * 1e4, irradianceQuantum({ exposure, toneMapping: 'linear' }));
  const reaches = [1, 2, 4, 8].map(reachAt);
  for (let i = 1; i < reaches.length; i++) assert.ok(reaches[i] > reaches[i - 1]);
  assert.ok(reaches.every((reach) => reach < 100));
  assert.equal(reachAt(1.2), reachAt(1.4), 'one half stop, one reach: a fade rewrites no lamp');
});

test('a display with no bound, or a light giving none, keeps the range', () => {
  const quantum = irradianceQuantum({ exposure: 1, toneMapping: 'aces' });
  for (const exposure of [0, -1, NaN, Infinity])
    assert.equal(irradianceQuantum({ exposure, toneMapping: 'aces' }), 0);
  assert.equal(irradianceQuantum({ exposure: 1, toneMapping: 'agx' }), 0, 'an unbounded curve');
  assert.equal(visibleReach(20, 1, 0), 20);
  assert.equal(visibleReach(20, 0, quantum), 20, 'zero intensity');
  assert.equal(visibleReach(20, NaN, quantum), 20);
  assert.equal(visibleReach(20, Infinity, quantum), 20);
  assert.ok(Number.isNaN(visibleReach(NaN, 1, quantum)), 'no range is made up');
  const endless = visibleReach(Infinity, 1, quantum);
  assert.ok(Number.isFinite(endless) && endless > 0, 'an infinite range gets a finite reach');
  assert.ok(Math.abs(visibleReach(endless * 1e3, 1, quantum) / endless - 1) < 1e-6, 'its limit');
});

test('a record keeps a range its emitter needs, and a rectangle its own', () => {
  const quantum = irradianceQuantum({ exposure: 1, toneMapping: 'aces' });
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
