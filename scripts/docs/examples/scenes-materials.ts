import { rotation } from './gltf-parts.ts';
import type { SceneNode } from './gltf-parts.ts';
import type { MaterialRow } from './gltf-types.ts';
import { brickNormals, checker, leaf, stripes } from './textures.ts';
import type { PartsScene, SurfacesScene } from './workshop.ts';
import { TAU, random, sceneOf, slab, workshop } from './workshop.ts';

/** Three painted solids beside three textured ones, the same shapes twice. */
function painted(): PartsScene {
  const shop = workshop();
  slab(shop, 0, 7);
  for (const [row, first] of [
    [-1.2, 1],
    [1.2, 4],
  ]) {
    shop.sphere(first, [-2, 0.7, row], 0.7);
    shop.box(first + 1, [0, 0.6, row], [1.2, 1.2, 1.2]);
    shop.cylinder(first + 2, [2, 0, row], 0.6, 1.4);
  }
  const map = (index: number) => ({ pbrMetallicRoughness: { baseColorTexture: { index } } });
  return sceneOf(
    'Painted and textured',
    shop,
    [
      ['Slate slab', [0.22, 0.24, 0.27, 1], 0, 0.85],
      ['Vermilion paint', [0.8, 0.2, 0.12, 1], 0, 0.35],
      ['Cobalt paint', [0.1, 0.25, 0.7, 1], 0, 0.35],
      ['Cream paint', [0.9, 0.85, 0.7, 1], 0, 0.35],
      ['Checker cloth', [1, 1, 1, 1], 0, 0.7, map(0)],
      ['Striped cloth', [1, 1, 1, 1], 0, 0.7, map(1)],
      ['Tile cloth', [1, 1, 1, 1], 0, 0.7, map(2)],
    ],
    {
      images: {
        'checker.png': checker(8, [0.9, 0.88, 0.82, 1], [0.15, 0.15, 0.18, 1]),
        'stripes.png': stripes(10, [0.85, 0.3, 0.25, 1], [0.95, 0.9, 0.8, 1]),
        'tiles.png': checker(4, [0.2, 0.45, 0.5, 1], [0.8, 0.8, 0.7, 1]),
      },
    },
  );
}

/** A flat wall whose bricks exist in its normal map alone, a pavement in front of it. */
function bricks(): PartsScene {
  const shop = workshop();
  shop.patch(1, 1, 1, (u, v) => [(u - 0.5) * 6, v * 3, 0]);
  shop.box(0, [0, -0.1, 1.5], [7, 0.2, 3]);
  shop.box(0, [0, 1.5, -0.2], [6.4, 3.4, 0.3]);
  return sceneOf(
    'Brick wall',
    shop,
    [
      ['Concrete', [0.5, 0.5, 0.48, 1], 0, 0.9],
      ['Brick', [0.62, 0.3, 0.22, 1], 0, 0.85, { normalTexture: { index: 0, scale: 1 } }],
    ],
    { images: { 'bricks-normal.png': brickNormals(12, 8) } },
  );
}

/** Leaves on a branch: each one is a flat quad cut to its outline by the alpha of its texture. */
function leaves(): PartsScene {
  const shop = workshop(),
    next = random(3),
    nodes: SceneNode[] = [{ name: 'branch', part: 'branch' }],
    leafShape = workshop();
  leafShape.patch(1, 1, 1, (u, v) => [(u - 0.5) * 0.4, v * 0.9, 0]);
  shop.cylinder(0, [0, 0, 0], 0.06, 4.2);
  slab(shop, 2, 4);
  for (let index = 0; index < 60; index++) {
    const height = 0.8 + next() * 3.2,
      around = next() * TAU;
    nodes.push({
      name: `leaf-${index}`,
      part: 'leaf',
      translation: [Math.cos(around) * 0.05, height, Math.sin(around) * 0.05],
      rotation: rotation([Math.sin(around), 0, -Math.cos(around)], 1.1 + next() * 0.6),
    });
  }
  return {
    name: 'Leaves cut by alpha',
    materials: [
      ['Bark', [0.3, 0.2, 0.12, 1], 0, 0.9],
      [
        'Leaf',
        [1, 1, 1, 1],
        0,
        0.6,
        {
          alphaMode: 'MASK',
          alphaCutoff: 0.5,
          pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        },
      ],
      ['Moss', [0.25, 0.3, 0.15, 1], 0, 0.95],
    ],
    parts: [
      { name: 'branch', surfaces: shop.surfaces },
      { name: 'leaf', surfaces: leafShape.surfaces },
    ],
    nodes,
    images: { 'leaf.png': leaf() },
  };
}

/** A neon tube — a ring and a bar — on a dark wall, its glass emitting on its own. */
function neon(): PartsScene {
  const shop = workshop();
  shop.box(0, [0, 1.5, -0.2], [6, 3.4, 0.2]);
  shop.box(0, [0, -0.1, 1.5], [6, 0.2, 3.4]);
  shop.patch(1, 48, 12, (u, v) => {
    const a = u * TAU,
      b = v * TAU;
    return [
      -1 + (0.7 + Math.cos(b) * 0.04) * Math.cos(a),
      1.6 + (0.7 + Math.cos(b) * 0.04) * Math.sin(a),
      Math.sin(b) * 0.04,
    ];
  });
  shop.patch(1, 12, 1, (u, v) => {
    const a = u * TAU;
    return [0.3 + v * 2.2, 1.6 + Math.sin(a) * 0.04, Math.cos(a) * 0.04];
  });
  return sceneOf('Neon sign', shop, [
    ['Dark render', [0.12, 0.12, 0.14, 1], 0, 0.9],
    [
      'Neon glass',
      [1, 0.4, 0.7, 1],
      0,
      0.3,
      {
        emissiveFactor: [1, 0.25, 0.6],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 6 } },
      },
    ],
  ]);
}

/** Eleven tiles of grey from black to white, twice: linear steps above, display steps below. */
function ramp(): SurfacesScene {
  const shop = workshop(),
    materials: MaterialRow[] = [['Graphite', [0.08, 0.08, 0.09, 1], 0, 0.9]],
    display = (value: number) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  slab(shop, 0, 8);
  for (let step = 0; step <= 10; step++)
    for (const [row, z, level] of [
      [0, -0.7, step / 10],
      [1, 0.7, display(step / 10)],
    ]) {
      materials.push([`Grey ${row} ${step}`, [level, level, level, 1], 0, 0.9]);
      shop.box(materials.length - 1, [(step - 5) * 0.62, 0.15, z], [0.56, 0.3, 0.56]);
    }
  return { name: 'Colour ramp', materials, surfaces: shop.surfaces };
}

export const materialScenes = { painted, bricks, leaves, neon, ramp };
