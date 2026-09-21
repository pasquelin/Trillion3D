import { rotation } from './gltf-parts.mjs';
import { TAU, random, slab, workshop } from './workshop.mjs';

const STONE = ['Grey stone', [0.55, 0.53, 0.5, 1], 0, 0.8],
  SAND = ['Sand', [0.68, 0.6, 0.45, 1], 0, 0.9];

/** Ten thousand pebbles, one mesh placed ten thousand times, scattered over a sand bed. */
function pebbles() {
  const pebble = workshop(),
    bed = workshop(),
    next = random(7),
    nodes = [{ name: 'bed', part: 'bed' }];
  // One pebble: a sphere flattened and lengthened, the scale of each node distorting it again.
  pebble.sphere(0, [0, 0, 0], 0.08, 12);
  slab(bed, 1, 20, 0.2);
  for (let index = 0; index < 10000; index++)
    nodes.push({
      name: `pebble-${index}`,
      part: 'pebble',
      translation: [(next() - 0.5) * 18, 0.03, (next() - 0.5) * 18],
      rotation: rotation([0, 1, 0], next() * TAU),
      scale: [0.7 + next(), 0.5 + next() * 0.4, 0.7 + next() * 0.8],
    });
  return {
    name: 'Field of pebbles',
    materials: [STONE, SAND],
    parts: [
      { name: 'pebble', surfaces: pebble.surfaces },
      { name: 'bed', surfaces: bed.surfaces },
    ],
    nodes,
  };
}

/** A vase: one profile of forty points turned around the vertical axis, on its slab. */
function vase() {
  const shop = workshop(),
    profile = [[0, 0]];
  // Outer wall from the foot to the lip, radius as a function of height, then the inner wall back
  // down: the turned surface is a shell, double-sided like every workshop material.
  for (let step = 0; step <= 30; step++) {
    const y = (step / 30) * 1.9,
      radius = 0.32 + 0.4 * Math.sin((y / 1.9) * Math.PI) ** 1.4 - 0.12 * Math.max(0, y - 1.5);
    profile.push([y, radius]);
  }
  profile.push([1.95, 0.5], [1.95, 0.42], [1.5, 0.3], [0.35, 0.28], [0.35, 0]);
  slab(shop, 0, 5);
  shop.lathe(1, [0, 0, 0], profile, 96);
  return {
    name: 'Turned vase',
    materials: [
      ['Walnut table', [0.3, 0.18, 0.1, 1], 0, 0.6],
      ['Celadon glaze', [0.55, 0.72, 0.6, 1], 0, 0.25],
    ],
    surfaces: shop.surfaces,
  };
}

/** A spiral staircase: one wedge-shaped step, placed thirty-six times up and around a column. */
function staircase() {
  const step = workshop(),
    column = workshop(),
    nodes = [{ name: 'column', part: 'column' }],
    sector = TAU / 22,
    tread = (u, v, y) => {
      const angle = (u - 0.5) * sector,
        radius = 0.2 + v * 1.25;
      return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
    };
  step.patch(0, 6, 1, (u, v) => tread(u, v, 0));
  step.patch(0, 6, 1, (u, v) => tread(1 - u, v, -0.18));
  step.patch(0, 1, 6, (u, v) => tread(v, 1, -0.18 * u));
  step.patch(0, 1, 6, (u, v) => tread(0, v, -0.18 * u));
  step.patch(0, 1, 6, (u, v) => tread(1, 1 - v, -0.18 * u));
  step.box(0, [1.38, 0.5, 0], [0.05, 1, 0.05]);
  column.cylinder(1, [0, 0, 0], 0.2, 7.2);
  slab(column, 1, 6);
  for (let index = 0; index < 36; index++)
    nodes.push({
      name: `step-${index}`,
      part: 'step',
      translation: [0, 0.18 + index * 0.18, 0],
      rotation: rotation([0, 1, 0], index * sector),
    });
  return {
    name: 'Spiral staircase',
    materials: [
      ['Oak step', [0.6, 0.42, 0.24, 1], 0, 0.65],
      ['Plaster column', [0.8, 0.78, 0.72, 1], 0, 0.85],
    ],
    parts: [
      { name: 'step', surfaces: step.surfaces },
      { name: 'column', surfaces: column.surfaces },
    ],
    nodes,
  };
}

/** Letters raised from a plaque: each stroke of a five-by-seven glyph is one block. */
function relief() {
  const shop = workshop(),
    // Strokes as [column, row, width, height] in cells, rows counted from the top; the strokes of
    // one glyph touch but never overlap, so no two faces share a plane.
    glyphs = {
      W: [
        [0, 0, 1, 6],
        [4, 0, 1, 6],
        [1, 6, 1, 1],
        [3, 6, 1, 1],
        [2, 3, 1, 3],
      ],
      E: [
        [0, 0, 5, 1],
        [0, 1, 1, 5],
        [1, 3, 3, 1],
        [0, 6, 5, 1],
      ],
      B: [
        [0, 0, 4, 1],
        [0, 1, 1, 5],
        [4, 1, 1, 2],
        [1, 3, 3, 1],
        [4, 4, 1, 2],
        [0, 6, 4, 1],
      ],
    },
    cell = 0.22,
    word = 'WEB';
  shop.box(0, [0, 1.1, -0.1], [word.length * 6 * cell + 0.6, 7 * cell + 0.8, 0.2]);
  word.split('').forEach((letter, index) =>
    glyphs[letter].forEach(([column, row, width, height]) => {
      const left = (index - word.length / 2) * 6 * cell + column * cell,
        top = 1.1 + (3.5 - row) * cell;
      shop.box(
        1,
        [left + (width * cell) / 2, top - (height * cell) / 2, 0.1],
        [width * cell, height * cell, 0.2],
      );
    }),
  );
  slab(shop, 0, 6);
  return {
    name: 'Letters in relief',
    materials: [
      ['Limestone plaque', [0.78, 0.74, 0.66, 1], 0, 0.85],
      ['Limestone letters', [0.8, 0.76, 0.68, 1], 0, 0.8],
    ],
    surfaces: shop.surfaces,
  };
}

/** Ten thousand boxes on a square grid, one mesh placed ten thousand times. */
function boxes() {
  const box = workshop(),
    ground = workshop(),
    nodes = [{ name: 'ground', part: 'ground' }];
  box.box(0, [0, 0.3, 0], [0.6, 0.6, 0.6]);
  slab(ground, 1, 160, 0.2);
  for (let row = 0; row < 100; row++)
    for (let column = 0; column < 100; column++)
      nodes.push({
        name: `box-${row}-${column}`,
        part: 'box',
        translation: [(column - 49.5) * 1.5, 0, (row - 49.5) * 1.5],
      });
  return {
    name: 'Grid of boxes',
    materials: [
      ['Terracotta', [0.75, 0.35, 0.22, 1], 0, 0.7],
      ['Concrete', [0.42, 0.42, 0.4, 1], 0, 0.9],
    ],
    parts: [
      { name: 'box', surfaces: box.surfaces },
      { name: 'ground', surfaces: ground.surfaces },
    ],
    nodes,
  };
}

export const geometryScenes = { pebbles, vase, staircase, relief, boxes };
