import { theatreWorkshop } from '../shadow-theatre/geometry.mjs';

export const TAU = Math.PI * 2;
export const unit = (v) => v.map((value) => value / Math.hypot(...v));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A flat slab under a scene, `size` wide, its top face at y = 0. */
export const slab = (shop, material, size = 8, thickness = 0.3) =>
  shop.box(material, [0, -thickness / 2, 0], [size, thickness, size]);

/** A deterministic sequence in [0, 1): the same scene from the same seed on every run. */
export function random(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** A workshop with the parts the example scenes need beyond the theatre's own. */
export function workshop() {
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

/** A scene made of one workshop: its surfaces as a single part, placed by the nodes it needs. */
export const sceneOf = (name, shop, materials, { nodes = [], images } = {}) => ({
  name,
  materials,
  ...(images ? { images } : {}),
  parts: [{ name: 'scene', surfaces: shop.surfaces }],
  nodes: [{ name: 'scene', part: 'scene' }, ...nodes],
});
