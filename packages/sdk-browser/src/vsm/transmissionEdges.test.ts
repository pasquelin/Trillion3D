// The exact read's edge rule (`transmissionWgsl.ts`: `vsmTInside`): every point of a sheet counted
// once — random points, points on shared edges and vertices, fans, the seams between clusters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { vsmTransmissionBinWgsl } from './transmissionWgsl.ts';
import {
  type Tri,
  type V,
  LAYOUT,
  count,
  f32,
  geometry,
  random,
  sheet,
  waves,
} from './transmissionSheets.fixture.ts';

test('the edge rule counts every point of a sheet once: random, on shared edges and on vertices', () => {
  const rnd = random(7);
  for (const [name, tris, move] of [
    ['a regular grid', sheet(16, 0, 128, (p) => p), (p: V) => p],
    ['a wave-moved grid', sheet(12, 4, 124, waves), waves],
  ] as const) {
    const points: V[] = [];
    for (let k = 0; k < 1200; k++) points.push([20 + 88 * rnd(), 20 + 88 * rnd()].map(f32));
    // Every interior vertex, and every point on a shared edge the grid holds exactly.
    for (const tri of tris)
      for (const v of tri) if (v.every((x) => x > 20 && x < 108)) points.push(v);
    if (name === 'a regular grid')
      for (let j = 3; j < 14; j++)
        for (let i = 3; i < 14; i++) points.push([8 * i + 4, 8 * j], [8 * i, 8 * j + 4]);
    for (const p of points) assert.equal(count(tris, p), 1, `${name} at ${p}`);
    // Outside the sheet, nothing.
    for (const p of [
      [-3, 50],
      [140, 60],
      [60, -9],
      [70, 150],
    ])
      assert.equal(count(tris, move(p).map(f32)), 0);
  }
});

test('a fan counts its shared vertex and spokes once; a triangle of no area holds nothing', () => {
  const centre = [64.25, 63.75];
  for (const spokes of [3, 5, 7, 12]) {
    const ring = Array.from({ length: spokes }, (_, k) => {
      const a = (2 * Math.PI * (k + 0.37)) / spokes;
      return [centre[0] + 30 * Math.cos(a), centre[1] + 30 * Math.sin(a)].map(f32);
    });
    const fan: Tri[] = ring.map((v, k) => [centre, v, ring[(k + 1) % spokes]]);
    assert.equal(count(fan, centre), 1, `${spokes} spokes: the centre`);
    for (const v of ring) {
      const mid = [(centre[0] + v[0]) / 2, (centre[1] + v[1]) / 2];
      assert.equal(count(fan, mid), 1, `${spokes} spokes: on a spoke`);
    }
  }
  const flat: Tri = [
    [10, 10],
    [20, 20],
    [40, 40],
  ];
  for (const p of [
    [10, 10],
    [15, 15],
    [30, 30],
  ])
    assert.equal(geometry.vsmTInside(...flat, p), false);
});

test('a sheet cut into clusters keeps its seams: each cluster projects its own border corners, counted once', () => {
  // The sea's grid cut into bands of 22 triangles, as the cut makes them; every band projects its
  // corners itself with the bin's mapping (`vsmTTexel`), from the same world positions.
  const bin = shaderRun<{ vsmTTexel: (h: V, scale: number, corner: V) => V }>(
    vsmTransmissionBinWgsl(LAYOUT),
    ['vsmTTexel'],
    {},
  );
  const world = (i: number, j: number) => [i * 0.25 + 0.03 * Math.sin(j), j * 0.25, 0].map(f32);
  const project = (p: V) =>
    bin.vsmTTexel([p[0] * 0.125 + 0.01, p[1] * 0.125 + 0.01, 0.5, 1], 128, [0, 0]);
  const bands: Tri[][] = [];
  for (let band = 0; band < 6; band++) {
    const tris: Tri[] = [];
    for (let j = band * 2; j < band * 2 + 2; j++)
      for (let i = 0; i < 11; i++) {
        const [a, b, c, d] = [
          world(i, j),
          world(i + 1, j),
          world(i + 1, j + 1),
          world(i, j + 1),
        ].map(project);
        tris.push([a, b, c], [a, c, d]);
      }
    bands.push(tris);
  }
  const all = bands.flat();
  const rnd = random(11);
  let seamPoints = 0;
  for (let band = 1; band < bands.length; band++) {
    // The seam's corners, from each side, to the same bits.
    const below = bands[band - 1].flatMap((t) => t);
    const above = bands[band].flatMap((t) => t);
    const shared = below.filter((v) => above.some((u) => u[0] === v[0] && u[1] === v[1]));
    assert.ok(shared.length >= 12, 'the bands share their seam corners');
    for (let k = 0; k + 1 < shared.length; k++) {
      const [a, b] = [shared[k], shared[k + 1]];
      for (const t of [0.25, 0.5, 0.75]) {
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (p[0] < 3 || p[0] > 43) continue;
        assert.equal(count(all, p), 1, `seam ${band} at ${p}`);
        seamPoints++;
      }
    }
  }
  assert.ok(seamPoints > 50);
  for (let k = 0; k < 2000; k++) {
    const p = [3 + 40 * rnd(), 3 + 44 * rnd()];
    assert.equal(count(all, p), 1, `inside at ${p}`);
  }
});
