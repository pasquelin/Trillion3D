/**
 * The host objects a node of the prepared scene carries or is — its light, its camera, its pose —
 * and the loader's rule for naming them, each built as the host loader built it from the same
 * declaration (`./graph.ts` assembles them).
 */
import * as THREE from 'three';
import type {
  TableCamera,
  TableLight,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts';

/** The loader's unique-name rule: sanitised, then numbered from the second use on. */
export function uniqueNames() {
  const used = new Map<string, number>();
  return (original: string) => {
    const name = THREE.PropertyBinding.sanitizeNodeName(original);
    const count = used.get(name);
    used.set(name, count === undefined ? 0 : count + 1);
    return count === undefined ? name : `${name}_${count + 1}`;
  };
}

export function light(declared: TableLight, name: string) {
  const colour = new THREE.Color(0xffffff);
  if (declared.color)
    colour.setRGB(
      declared.color[0],
      declared.color[1],
      declared.color[2],
      THREE.LinearSRGBColorSpace,
    );
  let made: THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight;
  if (declared.type === 'point') made = new THREE.PointLight(colour);
  else if (declared.type === 'directional') made = new THREE.DirectionalLight(colour);
  else {
    const inner = declared.innerConeAngle ?? 0,
      outer = declared.outerConeAngle ?? Math.PI / 4;
    made = new THREE.SpotLight(colour);
    made.angle = outer;
    made.penumbra = 1 - inner / outer;
  }
  if (!(made instanceof THREE.DirectionalLight)) made.distance = declared.range ?? 0;
  if (!(made instanceof THREE.PointLight)) {
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
    return new THREE.PerspectiveCamera(
      THREE.MathUtils.radToDeg(declared.yfov ?? 0),
      declared.aspectRatio || 1,
      declared.znear || 1,
      declared.zfar || 2e6,
    );
  const [x, y] = [declared.xmag ?? 0, declared.ymag ?? 0];
  return new THREE.OrthographicCamera(-x, x, y, -y, declared.znear ?? 0, declared.zfar ?? 0);
}

export function pose(node: THREE.Object3D, declared: TableNode) {
  if (declared.matrix) node.applyMatrix4(new THREE.Matrix4().fromArray(declared.matrix));
  else {
    if (declared.translation) node.position.fromArray(declared.translation);
    if (declared.rotation) node.quaternion.fromArray(declared.rotation);
    if (declared.scale) node.scale.fromArray(declared.scale);
  }
}
