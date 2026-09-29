// Engine nodes copied into the reference renderer; resources cross through `fromGraph.ts`.
import * as THREE from 'three';
import { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts';
import { Light } from '../../../packages/sdk-core/src/world/light/light.ts';
import {
  aimOf,
  isDrawnNode,
  isInstancedNode,
  isPlacedLight,
} from '../../../packages/sdk-browser/src/host/graph/kinds.ts';
import { resolveCameraWorld } from '../../../packages/sdk-browser/src/camera/world.ts';
import type { HostMaterials } from '../../../packages/sdk-browser/src/host/resources.ts';
import { threeGeometry, threeMaterials } from './fromGraph.ts';
import { Group, type Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts';
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts';

const cameras = new WeakMap<Camera, THREE.PerspectiveCamera | THREE.OrthographicCamera>();

/** A mesh of the library drawing an engine mesh's geometry and surface, posed by its caller;
 *  an instanced one keeps its placements' matrices and count. */
export function threeMeshCopy(mesh: {
  geometry: unknown;
  material: unknown;
}): THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> {
  const geometry = threeGeometry(mesh.geometry as Geometry),
    material = threeMaterials(mesh.material as HostMaterials);
  if (!isInstancedNode(mesh)) return new THREE.Mesh(geometry, material);
  const made = new THREE.InstancedMesh(geometry, material, mesh.instanceMatrix.count);
  made.instanceMatrix.array.set(mesh.instanceMatrix.array);
  made.count = mesh.count;
  return made;
}

/** The optics and pose fields every node kind shares, copied from the engine's node. */
function place<T extends THREE.Object3D>(into: T, node: Object3D): T {
  into.name = node.name;
  into.up.copy(node.up);
  into.position.copy(node.position);
  into.quaternion.set(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
  into.scale.copy(node.scale);
  into.matrix.fromArray(node.matrix.elements);
  into.matrixWorld.fromArray(node.matrixWorld.elements);
  into.matrixAutoUpdate = node.matrixAutoUpdate;
  into.visible = node.visible;
  into.castShadow = node.castShadow;
  into.receiveShadow = node.receiveShadow;
  into.frustumCulled = node.frustumCulled;
  into.renderOrder = node.renderOrder;
  into.userData = JSON.parse(JSON.stringify(node.userData)) as Record<string, unknown>;
  return into;
}

/** The library's light of an engine light: its kind, colour, strength, reach and cone. */
export function threeLight(light: Light | THREE.Light): THREE.Light {
  if (light instanceof THREE.Light) return light.clone();
  if (!isPlacedLight(light)) return place(threeSurroundingLight(light), light);
  const colour = new THREE.Color().setRGB(light.color.r, light.color.g, light.color.b);
  const made =
    light.kind === 'directional'
      ? new THREE.DirectionalLight(colour)
      : light.kind === 'point'
        ? new THREE.PointLight(colour)
        : new THREE.SpotLight(colour);
  place(made, light);
  made.intensity = light.intensity;
  if (made instanceof THREE.PointLight || made instanceof THREE.SpotLight) {
    made.distance = light.distance;
    made.decay = light.decay;
  }
  if (made instanceof THREE.SpotLight) {
    made.angle = light.angle;
    made.penumbra = light.penumbra;
  }
  if (made instanceof THREE.DirectionalLight || made instanceof THREE.SpotLight)
    place(made.target, light.target);
  return made;
}

/** The library's light of an engine light that takes no aim: ambient, rectangle or probe; any
 *  other kind is refused by name. */
function threeSurroundingLight(light: Light) {
  const colour = new THREE.Color().setRGB(light.color.r, light.color.g, light.color.b);
  if (light.kind === 'ambient') return new THREE.AmbientLight(colour, light.intensity);
  if (light.kind === 'rectArea')
    return Object.assign(
      new THREE.RectAreaLight(colour, light.intensity, light.width, light.height),
      { distance: light.distance },
    );
  if (light.kind !== 'probe') throw new Error(`${light.kind} light has no witness`);
  if (!light.sh) throw new Error('probe light with no coefficients has no witness');
  const probe = new THREE.LightProbe(undefined, light.intensity);
  probe.color.copy(colour);
  probe.sh.fromArray(light.sh);
  return probe;
}

/** A node of the library for one engine node, of the class its own class or `kind` names, its
 *  children not included: the one place an engine node is given a library's class. */
function threeNode(node: Object3D, bones: ReadonlySet<Object3D>): THREE.Object3D {
  if (bones.has(node)) return place(new THREE.Bone(), node);
  if (isDrawnNode(node)) {
    let mesh: THREE.Mesh;
    if (node.skeleton) {
      const skinned = new THREE.SkinnedMesh(
        threeGeometry(node.geometry).clone(),
        threeMaterials(node.material),
      );
      skinned.normalizeSkinWeights();
      mesh = skinned;
    } else mesh = threeMeshCopy(node);
    if (node.morphTargetInfluences) mesh.morphTargetInfluences = node.morphTargetInfluences.slice();
    if (node.morphTargetDictionary) mesh.morphTargetDictionary = { ...node.morphTargetDictionary };
    return place(mesh, node);
  }
  if (node instanceof Camera) return place(threeCameraOf(node), node);
  if (node instanceof Light) {
    const light = threeLight(node);
    // The target is a node of the graph: the copy of the graph places it, not the light.
    if ('target' in light) (light as THREE.DirectionalLight).target = new THREE.Object3D();
    return light;
  }
  return place(node instanceof Group ? new THREE.Group() : new THREE.Object3D(), node);
}

/** Copies the graph, its joint bindings and light targets into reference-renderer nodes. */
export function threeGraph(root: Object3D | THREE.Object3D): THREE.Object3D {
  if (root instanceof THREE.Object3D) return root;
  const bones = new Set<Object3D>();
  root.traverse((node) => {
    if (isDrawnNode(node) && node.skeleton) for (const bone of node.skeleton.bones) bones.add(bone);
  });
  const copies = new Map<Object3D, THREE.Object3D>();
  const copy = (node: Object3D): THREE.Object3D => {
    const made = threeNode(node, bones);
    copies.set(node, made);
    for (const child of node.children) made.add(copy(child));
    return made;
  };
  const made = copy(root);
  for (const [node, light] of copies) {
    if (isDrawnNode(node) && node.skeleton && light instanceof THREE.SkinnedMesh) {
      const skeleton = node.skeleton;
      const joints = skeleton.bones.map((bone) => {
        const copied = copies.get(bone);
        if (!(copied instanceof THREE.Bone)) throw new Error('WITNESS_BONE_OUTSIDE_GRAPH');
        return copied;
      });
      const inverses = joints.map((_, i) =>
        new THREE.Matrix4().fromArray(skeleton.boneInverses, i * 16),
      );
      light.bind(new THREE.Skeleton(joints, inverses), new THREE.Matrix4());
    }
    const target = node instanceof Light ? aimOf(node) : undefined;
    if (target)
      (light as THREE.DirectionalLight).target =
        copies.get(target) ?? place(new THREE.Object3D(), target);
  }
  return made;
}

/** A library camera of the engine camera's kind, at its optics. */
function threeCameraOf(camera: Camera) {
  const made =
    camera.projection === 'orthographic'
      ? new THREE.OrthographicCamera(
          camera.left,
          camera.right,
          camera.top,
          camera.bottom,
          camera.near,
          camera.far,
        )
      : new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  made.zoom = camera.zoom;
  made.updateProjectionMatrix();
  return made;
}

/** Copies engine camera pose and optics each frame; a library camera crosses unchanged. */
export function threeCamera(camera: Camera | THREE.Camera): THREE.Camera {
  if (camera instanceof THREE.Camera) return camera;
  let made = cameras.get(camera);
  if (!made) {
    made = threeCameraOf(camera);
    made.matrixAutoUpdate = false;
    cameras.set(camera, made);
  }
  made.matrix.fromArray(resolveCameraWorld(camera).matrixWorld.elements);
  made.matrixWorldNeedsUpdate = true;
  made.zoom = camera.zoom;
  made.near = camera.near;
  made.far = camera.far;
  if (made instanceof THREE.PerspectiveCamera) {
    made.fov = camera.fov;
    made.aspect = camera.aspect;
  } else {
    const { left, right, top, bottom } = camera;
    Object.assign(made, { left, right, top, bottom });
  }
  made.updateProjectionMatrix();
  made.updateMatrixWorld();
  return made;
}
