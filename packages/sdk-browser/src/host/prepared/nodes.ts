/**
 * The host objects a node of the prepared scene carries or is — its light, its camera, its pose —
 * and the loader's rule for naming them, each built as the host loader built it from the same
 * declaration (`./graph.ts` assembles them).
 */
import type {
  TableCamera,
  TableLight,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { GraphCamera } from '../graph/camera.ts';
import { GraphLight } from '../graph/light.ts';
import { type GraphMesh } from '../graph/mesh.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** The characters a node name may not hold, which the loader drops: the ones a path to an
 *  animated property is written with. */
const RESERVED = /[[\].:/]/g;
/** Degrees per radian, the factor a field of view is converted by. */
const RAD_TO_DEG = 180 / Math.PI;

/** The loader's unique-name rule: sanitised, then numbered from the second use on. */
export function uniqueNames() {
  const used = new Map<string, number>();
  return (original: string) => {
    const name = original.replace(/\s/g, '_').replace(RESERVED, '');
    const count = used.get(name);
    used.set(name, count === undefined ? 0 : count + 1);
    return count === undefined ? name : `${name}_${count + 1}`;
  };
}

export function light(declared: TableLight, name: string) {
  const colour = new Color().setRGB(1, 1, 1);
  if (declared.color) colour.setRGB(declared.color[0], declared.color[1], declared.color[2]);
  const made = new GraphLight(declared.type, colour);
  if (declared.type === 'spot') {
    const inner = declared.innerConeAngle ?? 0,
      outer = declared.outerConeAngle ?? Math.PI / 4;
    made.angle = outer;
    made.penumbra = 1 - inner / outer;
  }
  if (declared.type !== 'directional') made.distance = declared.range ?? 0;
  if (made.target) {
    made.target.position.set(0, 0, -1);
    made.add(made.target);
  }
  made.position.set(0, 0, 0);
  if (declared.intensity !== null) made.intensity = declared.intensity;
  made.name = name;
  return made;
}

export function camera(declared: TableCamera) {
  if (declared.type === 'perspective')
    return new GraphCamera({
      fov: (declared.yfov ?? 0) * RAD_TO_DEG,
      aspect: declared.aspectRatio || 1,
      near: declared.znear || 1,
      far: declared.zfar || 2e6,
    });
  const [x, y] = [declared.xmag ?? 0, declared.ymag ?? 0];
  return new GraphCamera(
    { near: declared.znear ?? 0, far: declared.zfar ?? 0 },
    { left: -x, right: x, top: y, bottom: -y },
  );
}

/** Morph weights set on a mesh, the first of them to the first targets; a mesh that morphs
 *  nothing is left alone, as the loader leaves it. */
export function weigh(mesh: GraphMesh, weights: readonly number[] | null) {
  if (!mesh.morphTargetInfluences) mesh.updateMorphTargets();
  if (!weights || !mesh.morphTargetInfluences) return;
  for (let i = 0; i < weights.length; i++) mesh.morphTargetInfluences[i] = weights[i];
}

/** Sets `node`'s pose from the one declared: a matrix decomposed, or translation, rotation and
 *  scale as they are. */
export function pose(
  node: Object3D,
  declared: Pick<TableNode, 'matrix' | 'translation' | 'rotation' | 'scale'>,
) {
  if (declared.matrix) node.applyMatrix4({ elements: declared.matrix });
  else {
    if (declared.translation) node.position.fromArray(declared.translation);
    if (declared.rotation) node.quaternion.fromArray(declared.rotation);
    if (declared.scale) node.scale.fromArray(declared.scale);
  }
}
