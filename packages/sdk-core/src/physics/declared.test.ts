import test from 'node:test';
import assert from 'node:assert/strict';
import type { CookedBody, CookedMass, ImplicitShape } from './cooked.ts';
import { declaredMass, declaredShape } from './declared.ts';
import { SHAPE } from './layout.ts';

const one = { x: 1, y: 1, z: 1 };
const body = (
  shape: ImplicitShape | { type: 'cooked'; mass?: CookedMass },
  motion: CookedBody['motion'] = {},
  cookedAt: [number, number, number] = [1, 1, 1],
) =>
  ({
    node: 7,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: cookedAt,
    motion,
    shape,
  }) as unknown as CookedBody;
const near = (actual: readonly number[] | undefined, expected: number[], label: string) => {
  assert.equal(actual?.length, expected.length, label);
  actual!.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${label}: ${actual}`));
};

test('an implicit shape is its primitive at the body scale, defaults filled in', () => {
  const at = (shape: ImplicitShape, s = one) => declaredShape(body(shape), s);
  assert.deepEqual(at({ type: 'box' }), { shape: SHAPE.box, size: [0.5, 0.5, 0.5], triangles: 0 });
  assert.deepEqual(
    at({ type: 'box', box: { size: [2, 4, 6] } }, { x: 1, y: 2, z: 3 }).size,
    [1, 4, 9],
  );
  assert.deepEqual(at({ type: 'sphere' }).size, [0.5, 0, 0]);
  assert.deepEqual(
    at({ type: 'sphere', sphere: { radius: 2 } }, { x: 3, y: 3, z: 3 }).size,
    [6, 0, 0],
  );
  assert.deepEqual(at({ type: 'capsule' }), {
    shape: SHAPE.capsule,
    size: [0.25, 0.25, 0],
    triangles: 0,
  });
  const capsule = {
    type: 'capsule',
    capsule: { height: 2, radiusTop: 0.5, radiusBottom: 0.5 },
  } as const;
  assert.deepEqual(at(capsule).size, [1, 0.5, 0]);
  assert.deepEqual(at({ type: 'cylinder' }), {
    shape: SHAPE.cylinder,
    size: [0.25, 0.25, 0],
    triangles: 0,
  });
  const cone = {
    type: 'cylinder',
    cylinder: { height: 4, radiusTop: 1, radiusBottom: 2 },
  } as const;
  assert.deepEqual(at(cone).size, [2, 1, 2]);
  assert.deepEqual(declaredShape(body({ type: 'cooked' }), { x: 2, y: 3, z: 4 }), {
    shape: SHAPE.cooked,
    size: [2, 3, 4],
    triangles: 0,
  });
});

test('a shape Jolt cannot make, or a scale that bends it, is refused by name', () => {
  const refused = (shape: ImplicitShape, s = one) =>
    assert.throws(() => declaredShape(body(shape), s), {
      code: 'PHYSICS_FAILED',
      details: { node: 7 },
      message: `The body of node 7 declares a ${shape.type} Jolt cannot make at scale ${s.x}, ${s.y}, ${s.z}.`,
    });
  refused({ type: 'capsule', capsule: { radiusTop: 0.5, radiusBottom: 0.25 } });
  refused({ type: 'sphere' }, { x: 1, y: 2, z: 1 });
});

test('nothing declared nor cooked weighs 0 and carries no mass frame', () => {
  assert.deepEqual(declaredMass(body({ type: 'box' }), one), { mass: 0, massFrame: undefined });
  assert.deepEqual(declaredMass(body({ type: 'box' }, { mass: 3 }), one), {
    mass: 3,
    massFrame: undefined,
  });
  const centred = declaredMass(body({ type: 'box' }, { centerOfMass: [1, 2, 3] }), {
    x: 2,
    y: 1,
    z: -1,
  });
  assert.deepEqual(
    centred,
    { mass: 0, massFrame: [2, 2, -3] },
    'the centre stretched by the scale',
  );
});

test('a declared inertia is turned by its orientation, about the origin unless a centre is declared', () => {
  const half = Math.SQRT1_2;
  const turned = declaredMass(
    body(
      { type: 'box' },
      { mass: 2, inertiaDiagonal: [1, 2, 3], inertiaOrientation: [0, 0, half, half] },
    ),
    one,
  );
  near(
    turned.massFrame,
    [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3],
    'a quarter turn about z swaps x and y',
  );
  const plain = declaredMass(
    body({ type: 'box' }, { inertiaDiagonal: [1, 2, 3], centerOfMass: [1, 0, 0] }),
    one,
  );
  near(plain.massFrame, [1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3], 'unturned, at the declared centre');
  const skew = declaredMass(
    body({ type: 'box' }, { inertiaDiagonal: [2, 3, 5], inertiaOrientation: [0.5, 0.5, 0.5, 0.5] }),
    one,
  );
  near(
    skew.massFrame!.slice(3),
    [5, 0, 0, 0, 2, 0, 0, 0, 3],
    'a third of a turn about the diagonal',
  );
});

/** The weighing of a box of sides `a`, `b`, `c` and mass `m`, centred at `centre`. */
const boxMass = (m: number, [a, b, c]: number[], centre: [number, number, number]): CookedMass => ({
  mass: m,
  centerOfMass: centre,
  inertia: [
    (m * (b * b + c * c)) / 12,
    0,
    0,
    0,
    (m * (a * a + c * c)) / 12,
    0,
    0,
    0,
    (m * (a * a + b * b)) / 12,
  ],
});

test('a cooked weighing is taken to the body scale as the stretched solid weighs', () => {
  const cooked = { type: 'cooked', mass: boxMass(8, [2, 2, 2], [0.5, 0, 0]) } as const;
  const { mass, massFrame } = declaredMass(body(cooked, {}, [1, 1, 2]), { x: 3, y: -2, z: 1 });
  // Scaled by (3, 2, 0.5) from where it was cooked, mirrored in y: a 6 × 4 × 1 box of mass 24.
  assert.equal(mass, 24);
  const stretched = boxMass(24, [6, 4, 1], [1.5, 0, 0]);
  near(massFrame, [...stretched.centerOfMass, ...stretched.inertia], 'centre and inertia');
});

test('a declared mass reweighs the cooked inertia, and a declared centre moves it there', () => {
  const cooked = { type: 'cooked', mass: boxMass(8, [2, 2, 2], [0, 0, 0]) } as const;
  const reweighed = declaredMass(body(cooked, { mass: 4 }), one);
  near(
    reweighed.massFrame,
    [0, 0, 0, ...boxMass(4, [2, 2, 2], [0, 0, 0]).inertia],
    'half the mass',
  );
  const off = { type: 'cooked', mass: boxMass(8, [2, 2, 2], [0, 1, -1]) } as const;
  const moved = declaredMass(body(off, { mass: 4, centerOfMass: [1, 3, 0] }), one);
  // Parallel axes: I + m (|d|² E − d dᵀ), d = (1, 2, 1) from the cooked centre, m = 4.
  const [i0, d] = [8 / 3, [1, 2, 1]];
  const parallel = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
    const [row, col] = [n % 3, Math.floor(n / 3)];
    return (row === col ? i0 + 4 * 6 : 0) - 4 * d[row] * d[col];
  });
  near(moved.massFrame, [1, 3, 0, ...parallel], 'moved');
  assert.deepEqual(declaredMass(body({ type: 'cooked' }), one), { mass: 0, massFrame: undefined });
});
