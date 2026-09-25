// CPU oracles of the order-2 spherical harmonics every probe shader compiles: the projection and
// the evaluation are run on the very shader text the GPU receives, against analytic lighting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IRRADIANCE_TERMS, irradianceShader, radianceProjectionShader } from './irradianceBasis.ts';

type Vector = { x: number; y: number; z: number };

/** Each term's polynomial, compiled from the shader text itself (`v.x*v.y` is valid JS). */
const polynomials = IRRADIANCE_TERMS.map(
  (term) => new Function('v', `return ${term.polynomial('v')};`) as (v: Vector) => number,
);

/** Projection of radiance samples, each weighted by its quadrature weight, per channel. */
function project(samples: { direction: Vector; rgb: number[]; weight: number }[]) {
  const sh = new Array<number>(27).fill(0);
  for (const { direction, rgb, weight } of samples)
    IRRADIANCE_TERMS.forEach((term, k) => {
      const harmonic = term.basis * polynomials[k](direction);
      for (let c = 0; c < 3; c++) sh[k * 3 + c] += rgb[c] * harmonic * weight;
    });
  return sh;
}

/** Irradiance at the normal `n`, unclamped: `Σ L_k · band_k · polynomial_k(n)`. */
const irradiance = (sh: number[], n: Vector) =>
  [0, 1, 2].map((c) =>
    IRRADIANCE_TERMS.reduce(
      (sum, term, k) => sum + sh[k * 3 + c] * term.band * polynomials[k](n),
      0,
    ),
  );

/** A Fibonacci sphere of `count` directions, each weighing `4π / count`. */
const sphere = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / count,
      radius = Math.sqrt(1 - z * z),
      angle = i * 2.39996323;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z };
  });

const unit = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
};
const normals = [unit(0, 0, 1), unit(1, 0, 0), unit(0, -1, 0), unit(1, 2, -3), unit(-2, 1, 1)];

test('a constant sky of radiance L gives the irradiance πL on every normal', () => {
  const sky = [1, 0.5, 2];
  const directions = sphere(20_000);
  const sh = project(
    directions.map((direction) => ({ direction, rgb: sky, weight: (4 * Math.PI) / 20_000 })),
  );
  for (const n of normals)
    irradiance(sh, n).forEach((value, c) =>
      assert.ok(Math.abs(value - Math.PI * sky[c]) < 1e-4 * Math.PI * sky[c], `${value}`),
    );
});

test('a single direction gives the order-2 truncation of its clamped cosine', () => {
  // A directional source of power Φ projects to `Φ · Y_k(s)`. Its irradiance at a normal is the
  // band sum `Φ · Σ_l Â_l (2l + 1) / 4π · P_l(n·s)` (Ramamoorthi and Hanrahan 2001, eq. 7–8),
  // written with Legendre polynomials rather than the basis the engine evaluates.
  const power = [3, 1, 0.25];
  const source = unit(0.3, -0.5, 0.8);
  const sh = project([{ direction: source, rgb: power, weight: 1 }]);
  const legendre = (t: number) =>
    0.25 + (2 / 3) * (3 / 4) * t + (1 / 4) * (5 / 4) * ((3 * t * t - 1) / 2);
  for (const n of [...normals, source]) {
    const t = n.x * source.x + n.y * source.y + n.z * source.z;
    irradiance(sh, n).forEach((value, c) =>
      assert.ok(Math.abs(value - power[c] * legendre(t)) < 1e-5 * power[c], `${t}: ${value}`),
    );
  }
  // Facing the source, the truncation overshoots the exact cosine by the published 1/16.
  assert.ok(Math.abs(irradiance(sh, source)[0] - power[0] * 1.0625) < 1e-5 * power[0]);
});

test('the shader text sums every term once, in band order', () => {
  const evaluation = irradianceShader((k) => `c${k}`, 'n');
  const projection = radianceProjectionShader((k) => `s${k}`, 'r', 'd').split('\n');
  assert.equal(projection.length, 9);
  IRRADIANCE_TERMS.forEach((term, k) => {
    assert.ok(evaluation.includes(`c${k}*((${term.polynomial('n')})*${term.band})`));
    assert.equal(projection[k], `s${k}+=r*((${term.polynomial('d')})*${term.basis});`);
  });
});
