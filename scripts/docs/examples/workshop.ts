import { theatreWorkshop } from '../shadow-theatre/geometry.ts';
import type { Mesh, Vec3 } from '../shadow-theatre/geometry.ts';
import type { MaterialRow } from './gltf-types.ts';
import type { SceneNode, ScenePart } from './gltf-parts.ts';

export const TAU = Math.PI * 2;

export const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A flat slab under a scene, `size` wide, its top face at y = 0. */
export const slab = (shop: Workshop, material: number, size = 8, thickness = 0.3) =>
  shop.box(material, [0, -thickness / 2, 0], [size, thickness, size]);

/** A deterministic sequence in [0, 1): the same scene from the same seed on every run. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** A workshop with the parts the example scenes need beyond the theatre's own. */
export function workshop() {
  const shop = theatreWorkshop();
  /** A box centred on `center` whose local x, y and z axes point along the world vectors `axes`. */
  const block = (material: number, center: Vec3, size: Vec3, axes: readonly [Vec3, Vec3, Vec3]) => {
    for (let axis = 0; axis < 3; axis++)
      for (const side of [-1, 1]) {
        const across = (axis + 1) % 3,
          up = (axis + 2) % 3;
        shop.patch(material, 1, 1, (u, v) => {
          const local: [number, number, number] = [0, 0, 0];
          local[axis] = (side * size[axis]) / 2;
          local[across] = side * (u - 0.5) * size[across];
          local[up] = (v - 0.5) * size[up];
          return [
            center[0] + local[0] * axes[0][0] + local[1] * axes[1][0] + local[2] * axes[2][0],
            center[1] + local[0] * axes[0][1] + local[1] * axes[1][1] + local[2] * axes[2][1],
            center[2] + local[0] * axes[0][2] + local[1] * axes[1][2] + local[2] * axes[2][2],
          ];
        });
      }
  };
  const sphere = (material: number, center: Vec3, radius: number, segments = 32) =>
    shop.patch(material, segments, segments / 2, (u, v) => {
      const phi = v * Math.PI,
        theta = u * TAU;
      return [
        center[0] + Math.sin(phi) * Math.cos(theta) * radius,
        center[1] - Math.cos(phi) * radius,
        center[2] + Math.sin(phi) * Math.sin(theta) * radius,
      ];
    });
  const torus = (material: number, center: Vec3, ring: number, tube: number) =>
    shop.patch(material, 48, 20, (u, v) => {
      const a = u * TAU,
        b = v * TAU;
      return [
        center[0] + (ring + Math.cos(b) * tube) * Math.cos(a),
        center[1] + Math.sin(b) * tube,
        center[2] + (ring + Math.cos(b) * tube) * Math.sin(a),
      ];
    });
  const cylinder = (material: number, center: Vec3, radius: number, height: number, top = radius) =>
    shop.lathe(material, center, [
      [0, 0],
      [0, radius],
      [height, top],
      [height, 0],
    ]);
  return { ...shop, block, sphere, torus, cylinder };
}

type Workshop = ReturnType<typeof workshop>;

/** A scene written as one mesh: the surfaces of one workshop, by material index. */
export interface SurfacesScene {
  name: string;
  materials: readonly MaterialRow[];
  surfaces: Map<number, Mesh>;
  parts?: undefined;
  nodes?: undefined;
  images?: Readonly<Record<string, Uint8Array>>;
}

/** A scene written as named parts, each placed by the nodes that name it. */
export interface PartsScene {
  name: string;
  materials: readonly MaterialRow[];
  parts: readonly ScenePart[];
  nodes: readonly SceneNode[];
  surfaces?: undefined;
  images?: Readonly<Record<string, Uint8Array>>;
}

export type ExampleScene = SurfacesScene | PartsScene;

/** A scene made of one workshop: its surfaces as a single part, placed by the nodes it needs. */
export const sceneOf = (
  name: string,
  shop: Workshop,
  materials: readonly MaterialRow[],
  {
    nodes = [],
    images,
  }: { nodes?: readonly SceneNode[]; images?: Readonly<Record<string, Uint8Array>> } = {},
): PartsScene => ({
  name,
  materials,
  ...(images ? { images } : {}),
  parts: [{ name: 'scene', surfaces: shop.surfaces }],
  nodes: [{ name: 'scene', part: 'scene' }, ...nodes],
});
