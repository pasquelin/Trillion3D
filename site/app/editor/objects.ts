import type {
  Geometry,
  Light,
  Material,
  Mesh,
  Object3D,
} from '../../../packages/sdk-browser/src/index.ts';
import type { Engine } from './session.ts';
import { applyPose } from './commands.ts';

/** The shapes the Add menu builds, each with the first arguments of its family call named. */
export const SHAPES = {
  box: ['width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments'],
  sphere: ['radius', 'widthSegments', 'heightSegments'],
  cylinder: ['radiusTop', 'radiusBottom', 'height', 'radialSegments', 'heightSegments'],
  cone: ['radius', 'height', 'radialSegments', 'heightSegments'],
  torus: ['radius', 'tube', 'radialSegments', 'tubularSegments', 'arc'],
  plane: ['width', 'height', 'widthSegments', 'heightSegments'],
} as const;
type Shape = keyof typeof SHAPES;
export const LIGHTS = ['point', 'spot', 'directional', 'ambient'] as const;
type LightKind = (typeof LIGHTS)[number];
export type AddKind = Shape | LightKind | 'group';

/** The first size the Add menu gives each shape: about one unit across, standing on the grid. */
const FIRST_SIZE: Record<Shape, number[]> = {
  box: [1, 1, 1],
  sphere: [0.5, 32, 16],
  cylinder: [0.5, 0.5, 1, 32],
  cone: [0.5, 1, 32],
  torus: [0.5, 0.2, 16, 48],
  plane: [4, 4],
};
/** Where each light starts, and how strong: above the grid, aimed at its centre. */
const FIRST_LIGHT: Record<LightKind, { intensity: number; position: [number, number, number] }> = {
  point: { intensity: 10, position: [0, 2, 0] },
  spot: { intensity: 20, position: [2, 4, 2] },
  directional: { intensity: 3, position: [3, 5, 2] },
  ambient: { intensity: 0.3, position: [0, 0, 0] },
};

type Build = (...args: unknown[]) => Geometry;
/** The geometry family member that built `type`, or undefined for a shape the family lacks. */
export const shapeBuilder = (engine: Engine, type: string) =>
  (engine.geometry as unknown as Record<string, Build | undefined>)[type];

export const isMesh = (node: Object3D): node is Mesh => (node as Mesh).isMesh === true;
export const isLight = (node: Object3D): node is Light => (node as Light).isLight === true;
const isModel = (node: Object3D) => (node as { isLoadedModel?: boolean }).isLoadedModel === true;
/** The one material of a mesh the inspector edits; a mesh wearing one per group has none. */
export const materialOf = (node: Object3D) =>
  isMesh(node) && !Array.isArray(node.material) ? (node.material as Material) : null;

/** A new object of `kind`, named `name`: a shape in a material of its own, a light, a group. */
export function build(engine: Engine, kind: AddKind, name: string): Object3D {
  let node: Object3D;
  if (kind === 'group') node = engine.object.group();
  else if (kind in FIRST_LIGHT) {
    const first = FIRST_LIGHT[kind as LightKind];
    node = engine.light[kind as LightKind]({ ...first, castShadow: kind !== 'ambient' });
  } else {
    const shape = kind as Shape;
    const matter = engine.material.meshStandard({
      color: '#b8c4d6',
      roughness: 0.6,
      side: shape === 'plane' ? 'double' : 'front',
    });
    node = engine.object.mesh(shapeBuilder(engine, shape)!(...FIRST_SIZE[shape]), matter);
    // A plane lies on the grid, a solid stands on it.
    if (shape === 'plane') node.rotation.x = -Math.PI / 2;
    else node.position.y = shape === 'torus' ? 0.2 : 0.5;
  }
  node.name = name;
  return node;
}

/** A shape built again from its recipe, or the same shape when nothing records how it was made. */
function sameShape(engine: Engine, geometry: Geometry) {
  const recipe = geometry.recipe;
  const again = recipe && shapeBuilder(engine, recipe.type);
  return again ? again(...recipe.args) : geometry;
}

/**
 * A copy of `source` and of what it holds, with materials of its own: a later edit of one leaves
 * the other alone. A loaded model is not copied (it would load again from its address, which a
 * copy made at once cannot wait for): null for it, and it is left out of a copied group.
 */
export function duplicate(engine: Engine, source: Object3D): Object3D | null {
  if (isModel(source)) return null;
  let copy: Object3D;
  if (isMesh(source)) {
    const worn = source.material;
    const matter = Array.isArray(worn) ? worn.map((m) => m.clone()) : worn.clone();
    copy = engine.object.mesh(sameShape(engine, source.geometry), matter);
  } else if (isLight(source)) {
    const { color, intensity, distance, decay, angle, penumbra, castShadow } = source;
    const make = engine.light[source.kind as LightKind] ?? engine.light.point;
    copy = make({ color, intensity, distance, decay, angle, penumbra, castShadow });
  } else copy = engine.object.group();
  copy.name = source.name;
  applyPose(copy, source);
  copy.visible = source.visible;
  copy.castShadow = source.castShadow;
  copy.receiveShadow = source.receiveShadow;
  for (const child of source.children) {
    const inner = duplicate(engine, child);
    if (inner) copy.add(inner);
  }
  return copy;
}
