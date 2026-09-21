import { TAU, cross, slab, unit, workshop } from './workshop.mjs';

/** A cube standing on one corner over a slab: its body diagonal becomes the vertical. */
function cornerCube() {
  const shop = workshop(),
    side = 1.6,
    up = unit([1, 1, 1]),
    right = unit([1, -1, 0]),
    rows = [right, up, cross(right, up)],
    // The rotation whose second row is the diagonal sends the diagonal onto the vertical.
    axes = [0, 1, 2].map((i) => rows.map((row) => row[i]));
  slab(shop, 0, 6);
  shop.block(1, [0, (side * Math.sqrt(3)) / 2, 0], [side, side, side], axes);
  return {
    name: 'Cube on its corner',
    materials: [
      ['Slate slab', [0.22, 0.24, 0.27, 1], 0, 0.85],
      ['Coral enamel', [0.85, 0.28, 0.2, 1], 0.1, 0.35],
    ],
    surfaces: shop.surfaces,
  };
}

/** A still life: sphere, cylinder, cone, torus and box, arranged on one slab. */
function stillLife() {
  const shop = workshop();
  slab(shop, 0, 8);
  shop.sphere(1, [-2.2, 0.9, -0.8], 0.9);
  shop.cylinder(2, [0.4, 0, -1.6], 0.6, 1.8);
  shop.cylinder(3, [2.3, 0, 0.2], 0.8, 2, 0);
  shop.torus(4, [-0.6, 0.35, 1.6], 0.9, 0.32);
  shop.box(5, [1.9, 0.55, 2.2], [1.1, 1.1, 1.1]);
  return {
    name: 'Still life of primitives',
    materials: [
      ['Slate slab', [0.22, 0.24, 0.27, 1], 0, 0.85],
      ['Ivory sphere', [0.9, 0.86, 0.76, 1], 0, 0.4],
      ['Teal cylinder', [0.1, 0.55, 0.5, 1], 0.2, 0.5],
      ['Ochre cone', [0.8, 0.55, 0.15, 1], 0, 0.6],
      ['Brass torus', [0.8, 0.6, 0.25, 1], 0.9, 0.3],
      ['Plum box', [0.4, 0.15, 0.35, 1], 0, 0.7],
    ],
    surfaces: shop.surfaces,
  };
}

/** Five rows of five spheres: roughness grows to the right, metalness grows toward the back. */
function clayToChrome() {
  const shop = workshop(),
    materials = [['Graphite slab', [0.08, 0.08, 0.09, 1], 0, 0.9]];
  slab(shop, 0, 7);
  for (let row = 0; row < 5; row++)
    for (let column = 0; column < 5; column++) {
      materials.push([
        `Copper r${column} m${row}`,
        [0.92, 0.55, 0.32, 1],
        row / 4,
        0.08 + (column / 4) * 0.9,
      ]);
      shop.sphere(materials.length - 1, [(column - 2) * 1.25, 0.5, (row - 2) * 1.25], 0.5, 24);
    }
  return { name: 'From clay to chrome', materials, surfaces: shop.surfaces };
}

/** A round dial with a slanted gnomon and twelve hour posts around its rim. */
function sundial() {
  const shop = workshop(),
    tilt = unit([0, 1, -1]),
    across = [1, 0, 0],
    forward = cross(across, tilt);
  shop.cylinder(0, [0, -0.4, 0], 3.2, 0.4);
  shop.block(1, [0, 0.7, -0.5], [0.08, 2, 0.08], [across, tilt, forward]);
  for (let hour = 0; hour < 12; hour++) {
    const angle = (hour / 12) * TAU;
    shop.box(1, [Math.cos(angle) * 2.8, 0.2, Math.sin(angle) * 2.8], [0.16, 0.4, 0.16]);
  }
  return {
    name: 'Sundial',
    materials: [
      ['Limestone dial', [0.82, 0.78, 0.68, 1], 0, 0.8],
      ['Bronze gnomon', [0.55, 0.38, 0.2, 1], 0.9, 0.35],
    ],
    surfaces: shop.surfaces,
  };
}

/** Two rows of columns under their lintels, a long floor down the middle. */
function colonnade() {
  const shop = workshop();
  shop.box(0, [0, -0.15, 0], [6, 0.3, 14]);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 6; index++) {
      const z = index * 2.4 - 6;
      shop.lathe(
        1,
        [side * 1.8, 0, z],
        [
          [0, 0],
          [0, 0.42],
          [0.25, 0.42],
          [0.25, 0.3],
          [2.7, 0.28],
          [2.7, 0.4],
          [2.95, 0.42],
          [2.95, 0],
        ],
      );
    }
    shop.box(1, [side * 1.8, 3.15, 0], [0.9, 0.4, 13.5]);
  }
  return {
    name: 'Colonnade',
    materials: [
      ['Sand floor', [0.6, 0.55, 0.45, 1], 0, 0.9],
      ['Chalk stone', [0.88, 0.85, 0.78, 1], 0, 0.7],
    ],
    surfaces: shop.surfaces,
  };
}

export const scenes = {
  'corner-cube': cornerCube,
  'still-life': stillLife,
  'clay-to-chrome': clayToChrome,
  sundial,
  colonnade,
};
