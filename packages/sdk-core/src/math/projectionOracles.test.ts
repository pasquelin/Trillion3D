// The screen error announced by `clusterErrorPixels` is a contract: it majors the displacement, in
// pixels, of any point of the sphere moved by at most ε. Defect 3 took it on the distance from
// the centre to the eye, which ignored the displacement direction and the distance to the view axis:
// off-axis, the announced value fell under the real one. These tests hold the bound against a
// real perspective projection, and `clusterErrorAtDepth` against `clusterErrorPixels`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterErrorAtDepth, clusterErrorPixels, screenErrorBound } from '../index.ts';

const FOCALE = 640,
  PROCHE = 0.25;

/** The old formula, as the engine applied it: `ε·s·f / (|C| − r·s)`. */
function ancienne(error: number, stretch: number, c: number[], radius: number) {
  const distance = Math.hypot(c[0], c[1], c[2]) - radius * stretch;
  return distance > PROCHE ? (error * stretch * FOCALE) / distance : Infinity;
}

const pixel = (p: number[]) => [(FOCALE * p[0]) / -p[2], (FOCALE * p[1]) / -p[2]];

/** Points spread on the sphere (Fibonacci spiral), centre included. */
function surface(centre: number[], radius: number, n = 240) {
  const points = [centre.slice()],
    or = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n,
      r = Math.sqrt(Math.max(0, 1 - z * z)),
      a = or * i;
    points.push([
      centre[0] + radius * r * Math.cos(a),
      centre[1] + radius * r * Math.sin(a),
      centre[2] + radius * z,
    ]);
  }
  return points;
}

/** Unit directions: the six axes, the diagonals, and the spiral, for the worst displacement. */
function directions(n = 120) {
  const liste = [];
  for (const axe of [0, 1, 2])
    for (const signe of [-1, 1]) {
      const v = [0, 0, 0];
      v[axe] = signe;
      liste.push(v);
    }
  const or = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n,
      r = Math.sqrt(Math.max(0, 1 - z * z)),
      a = or * i;
    liste.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return liste;
}

/** The worst real screen displacement: every point of the sphere, every direction, of length ε. */
function pireDeplacement(centre: number[], radius: number, epsilon: number) {
  let pire = 0;
  for (const p of surface(centre, radius)) {
    if (-p[2] <= PROCHE) continue;
    const before = pixel(p);
    for (const d of directions()) {
      const after = [p[0] + epsilon * d[0], p[1] + epsilon * d[1], p[2] + epsilon * d[2]];
      if (-after[2] <= PROCHE) return Infinity;
      const q = pixel(after);
      pire = Math.max(pire, Math.hypot(q[0] - before[0], q[1] - before[1]));
    }
  }
  return pire;
}

const annonce = (centre: number[], radius: number, epsilon: number, stretch = 1) =>
  clusterErrorPixels(epsilon, stretch, centre[0], centre[1], centre[2], radius, FOCALE, PROCHE);

test('the bound majors the real screen displacement, off-axis as on-axis', () => {
  const cas: Array<{ name: string; centre: number[]; radius: number; epsilon: number }> = [
    { name: 'on-axis', centre: [0, 0, -10], radius: 1, epsilon: 0.05 },
    { name: 'off-axis', centre: [8, 0, -10], radius: 1, epsilon: 0.05 },
    { name: 'off-axis on a diagonal', centre: [6, -7, -12], radius: 2, epsilon: 0.2 },
    { name: 'near the near plane', centre: [0.4, 0.3, -2], radius: 0.5, epsilon: 0.01 },
    { name: 'large distant sphere', centre: [-40, 15, -300], radius: 30, epsilon: 1.5 },
  ];
  for (const { name, centre, radius, epsilon } of cas) {
    const reel = pireDeplacement(centre, radius, epsilon);
    assert.ok(
      reel <= annonce(centre, radius, epsilon),
      `${name}: real ${reel} px above the announced ${annonce(centre, radius, epsilon)} px`,
    );
  }
});

test('off-axis, the old formula announced less than the real displacement', () => {
  const centre = [8, 0, -10],
    radius = 1,
    epsilon = 0.05;
  const reel = pireDeplacement(centre, radius, epsilon);
  assert.ok(
    reel > ancienne(epsilon, 1, centre, radius),
    `defect 3 assumes a real ${reel} px above the old announced`,
  );
  assert.ok(reel <= annonce(centre, radius, epsilon), 'and the corrected bound covers it');
});

test('clusterErrorAtDepth is clusterErrorPixels whose axis and depth are already taken', () => {
  const centres: Array<[number, number, number]> = [
    [0, 0, -10],
    [-30, 4, -120],
    [0.001, 0, -0.2],
    [0, 0, 0],
    [0, 0, 10],
  ];
  for (const [x, y, z] of centres)
    for (const error of [0, 1e-6, 0.5, 9, Infinity])
      for (const radius of [0, 1, 40])
        assert.ok(
          Object.is(
            clusterErrorAtDepth(error, 1.25, Math.sqrt(x * x + y * y), -z, radius, FOCALE, PROCHE),
            clusterErrorPixels(error, 1.25, x, y, z, radius, FOCALE, PROCHE),
          ),
          `error ${error}, radius ${radius}, centre ${x},${y},${z}`,
        );
});

test('a sphere behind the eye or touching the near plane announces infinity', () => {
  assert.equal(annonce([0, 0, 10], 1, 0.05), Infinity, 'behind the eye');
  assert.equal(annonce([0, 0, -0.3], 1, 0.05), Infinity, 'straddling the near plane');
  assert.equal(annonce([0, 0, -1], 0, 2), Infinity, 'displaced onto the near plane');
});

test('a zero error projects nothing and an infinite error stays selectable', () => {
  assert.equal(annonce([8, 0, -10], 1, 0), 0);
  assert.equal(annonce([8, 0, -0.1], 1, 0), 0, 'even against the near plane');
  assert.equal(annonce([8, 0, -10], 1, Infinity), Infinity);
});

test('the bound decreases with distance and grows with the bounding sphere', () => {
  const centre = [6, -7, -12];
  let precedent = Infinity;
  for (const k of [1, 1.5, 2, 4, 8]) {
    const loin = annonce(
      centre.map((v) => v * k),
      1,
      0.05,
    );
    assert.ok(loin < precedent, `ray ${k} announces ${loin} px, not less than ${precedent} px`);
    precedent = loin;
  }
  let englobant = 0;
  for (const radius of [0, 0.5, 1, 3]) {
    const valeur = annonce(centre, radius, 0.05);
    assert.ok(valeur > englobant, `radius ${radius}: ${valeur} px does not bound ${englobant} px`);
    englobant = valeur;
  }
});

test('clusterErrorAtDepth rejects the same malformed parameters as clusterErrorPixels', () => {
  assert.throws(
    () => clusterErrorAtDepth(1, 1, NaN, 10, 1, 600, 0.1),
    /Invalid cluster parameters/,
  );
  assert.throws(() => clusterErrorAtDepth(1, 1, 0, NaN, 1, 600, 0.1), /Invalid cluster parameters/);
  assert.throws(() => clusterErrorAtDepth(-1, 1, 0, 10, 1, 600, 0.1), /Invalid cluster parameters/);
  assert.throws(() => clusterErrorAtDepth(1, 1, 0, 10, -1, 600, 0.1), /Invalid cluster parameters/);
  assert.throws(
    () => clusterErrorPixels(1, 1, NaN, 0, -10, 1, 600, 0.1),
    /Invalid cluster parameters/,
  );
});

test('screenErrorBound keeps no guard: the caller has already sorted its parameters', () => {
  assert.equal(screenErrorBound(0.05, 1, Infinity, 10, 1, FOCALE, PROCHE), Infinity);
  assert.equal(screenErrorBound(0.05, 1, 8, Infinity, 1, FOCALE, PROCHE), Infinity);
  assert.ok(Number.isFinite(screenErrorBound(0.05, 1, 8, 10, 1, FOCALE, PROCHE)));
});
