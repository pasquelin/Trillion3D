import { TAU, random, sceneOf, slab, workshop } from './workshop.mjs';

/** A lamp on its post, a glass globe around the bulb, a wall behind to catch its light. */
function lantern() {
  const shop = workshop();
  slab(shop, 0, 8);
  shop.box(0, [0, 2, -2.5], [8, 4, 0.3]);
  shop.cylinder(1, [0, 0, 0], 0.08, 2.2);
  shop.cylinder(1, [0, 0, 0], 0.3, 0.1);
  shop.sphere(2, [0, 2.4, 0], 0.09, 16);
  shop.sphere(3, [0, 2.4, 0], 0.32, 32);
  return sceneOf('Lamp in its glass', shop, [
    ['Pavement', [0.45, 0.44, 0.42, 1], 0, 0.9],
    ['Iron post', [0.12, 0.12, 0.13, 1], 0.8, 0.5],
    ['Bulb', [1, 0.9, 0.7, 1], 0, 0.5, { emissiveFactor: [1, 0.8, 0.5] }],
    ['Glass globe', [0.9, 0.95, 1, 0.22], 0, 0.1, { alphaMode: 'BLEND' }],
  ]);
}

/** A red wall in the sun beside a white floor and a white column, for the light that bounces. */
function redWall() {
  const shop = workshop();
  slab(shop, 0, 8);
  shop.box(1, [-2.5, 1.5, 0], [0.3, 3, 8]);
  shop.box(0, [-1.2, 1, 0.8], [0.6, 2, 0.6]);
  return sceneOf('Red wall', shop, [
    ['White plaster', [0.82, 0.8, 0.76, 1], 0, 0.9],
    ['Red paint', [0.75, 0.08, 0.05, 1], 0, 0.7],
  ]);
}

/** A lighthouse on its rock, a shore of sand and boulders around it. */
function lighthouse() {
  const shop = workshop(),
    next = random(11);
  slab(shop, 0, 30, 0.4);
  shop.lathe(
    1,
    [0, 0, 0],
    [
      [0, 0],
      [0, 4],
      [1.2, 3.4],
      [1.6, 2.6],
      [1.6, 0],
    ],
  );
  shop.lathe(
    2,
    [0, 1.6, 0],
    [
      [0, 0],
      [0, 1.4],
      [4.6, 1],
      [4.6, 1.3],
      [4.9, 1.3],
      [4.9, 0],
    ],
  );
  shop.cylinder(3, [0, 6.5, 0], 0.9, 1.4);
  shop.cylinder(2, [0, 7.9, 0], 1.3, 0.2, 0.3);
  for (let index = 0; index < 24; index++) {
    const distance = 4 + next() * 8,
      angle = next() * TAU;
    shop.sphere(
      1,
      [Math.cos(angle) * distance, -0.2, Math.sin(angle) * distance],
      0.5 + next(),
      12,
    );
  }
  return sceneOf('Lighthouse', shop, [
    ['Wet sand', [0.5, 0.47, 0.4, 1], 0, 0.7],
    ['Rock', [0.28, 0.27, 0.26, 1], 0, 0.9],
    ['Whitewash', [0.85, 0.83, 0.78, 1], 0, 0.8],
    ['Lantern glass', [0.8, 0.85, 0.9, 0.3], 0, 0.1, { alphaMode: 'BLEND' }],
  ]);
}

/** A hall whose scene file carries its own lamps: three kept, and two the compiler refuses. */
function hall() {
  const shop = workshop();
  slab(shop, 0, 10);
  shop.box(0, [0, 2, -4.85], [10, 4, 0.3]);
  for (const x of [-3, 0, 3]) shop.cylinder(1, [x, 0, -2], 0.3, 4);
  shop.sphere(1, [0, 0.6, 1.5], 0.6);
  const lamp = (name, x, color, intensity) => ({
    name,
    translation: [x, 3.2, 0],
    light: { type: 'point', color, intensity, range: 9 },
  });
  return sceneOf(
    'Hall with its lamps',
    shop,
    [
      ['Plaster', [0.7, 0.68, 0.64, 1], 0, 0.9],
      ['Grey stone', [0.4, 0.4, 0.42, 1], 0, 0.6],
    ],
    {
      nodes: [
        lamp('warm-lamp', -3, [1, 0.7, 0.4], 9000),
        lamp('white-lamp', 0, [1, 1, 1], 7000),
        lamp('cool-lamp', 3, [0.5, 0.7, 1], 9000),
        // Two lamps the contract cannot hold: a point light of negative intensity, and a spot
        // light whose node is flattened along its axis, so it points nowhere. The compiler counts
        // them in `lights.json` by reason and keeps the three others.
        { name: 'dead-lamp', translation: [2, 3, 2], light: { type: 'point', intensity: -5 } },
        {
          name: 'flat-lamp',
          translation: [-2, 3, 2],
          scale: [1, 1, 0],
          light: { type: 'spot', intensity: 500, spot: { outerConeAngle: 0.5 } },
        },
      ],
    },
  );
}

export const lightScenes = { lantern, 'red-wall': redWall, lighthouse, hall };
