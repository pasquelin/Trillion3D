import { theatreWorkshop } from '../shadow-theatre/geometry.ts';

const TAU = Math.PI * 2;
const unit = (v) => v.map((value) => value / Math.hypot(...v));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A workshop with the parts the example scenes need beyond the theatre's own. */
function workshop() {
  const shop = theatreWorkshop();
  /** A box centred on `center` whose local x, y and z axes point along the world vectors `axes`. */
  const block = (material, center, size, axes) => {
    for (let axis = 0; axis < 3; axis++)
      for (const side of [-1, 1]) {
        const across = (axis + 1) % 3,
          up = (axis + 2) % 3;
        shop.patch(material, 1, 1, (u, v) => {
          const local = [0, 0, 0];
          local[axis] = (side * size[axis]) / 2;
          local[across] = side * (u - 0.5) * size[across];
          local[up] = (v - 0.5) * size[up];
          return center.map(
            (value, k) =>
              value + local[0] * axes[0][k] + local[1] * axes[1][k] + local[2] * axes[2][k],
          );
        });
      }
  };
  const sphere = (material, center, radius, segments = 32) =>
    shop.patch(material, segments, segments / 2, (u, v) => {
      const phi = v * Math.PI,
        theta = u * TAU;
      return [
        center[0] + Math.sin(phi) * Math.cos(theta) * radius,
        center[1] - Math.cos(phi) * radius,
        center[2] + Math.sin(phi) * Math.sin(theta) * radius,
      ];
    });
  const torus = (material, center, ring, tube) =>
    shop.patch(material, 48, 20, (u, v) => {
      const a = u * TAU,
        b = v * TAU;
      return [
        center[0] + (ring + Math.cos(b) * tube) * Math.cos(a),
        center[1] + Math.sin(b) * tube,
        center[2] + (ring + Math.cos(b) * tube) * Math.sin(a),
      ];
    });
  const cylinder = (material, center, radius, height, top = radius) =>
    shop.lathe(material, center, [
      [0, 0],
      [0, radius],
      [height, top],
      [height, 0],
    ]);
  return { ...shop, block, sphere, torus, cylinder };
}

const slab = (shop, material, size = 8, thickness = 0.3) =>
  shop.box(material, [0, -thickness / 2, 0], [size, thickness, size]);

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
