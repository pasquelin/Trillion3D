/**
 * THE ENGINE'S GRAPH, HANDED TO THE REFERENCE RENDERER — its nodes: a whole graph copied node for
 * node, a light copied for the display graph that lights a frame, and the camera the renderer
 * draws from, brought each frame to the engine camera's pose and optics. The resources the nodes
 * hold cross through `fromGraph.ts`; nothing is computed here.
 */
import * as THREE from 'three';
import type { GraphCamera } from '../graph/camera.ts';
import type { GraphLight } from '../graph/light.ts';
import type { GraphMesh } from '../graph/mesh.ts';
import type { GraphNode } from '../graph/node.ts';
import { resolveCameraWorld } from '../../camera/world.ts';
import type { HostMaterials } from '../resources.ts';
import type { GraphGeometry } from '../graph/geometry.ts';
import { threeGeometry, threeMaterials } from './fromGraph.ts';

const cameras = new WeakMap<GraphCamera, THREE.PerspectiveCamera | THREE.OrthographicCamera>();

/** A mesh of the library drawing an engine mesh's geometry and surface, posed by its caller. */
export function threeMeshCopy(mesh: {
  geometry: unknown;
  material: unknown;
}): THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> {
  return new THREE.Mesh(
    threeGeometry(mesh.geometry as GraphGeometry),
    threeMaterials(mesh.material as HostMaterials),
  );
}

/** The optics and pose fields every node kind shares, copied from the engine's node. */
function place(into: THREE.Object3D, node: GraphNode) {
  into.name = node.name;
  into.up.copy(node.up);
  into.position.copy(node.position);
  into.quaternion.set(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
  into.scale.copy(node.scale);
  into.matrix.fromArray(node.matrix.elements);
  into.matrixWorld.fromArray(node.matrixWorld.elements);
  into.matrixAutoUpdate = node.matrixAutoUpdate;
  into.matrixWorldAutoUpdate = node.matrixWorldAutoUpdate;
  into.visible = node.visible;
  into.castShadow = node.castShadow;
  into.receiveShadow = node.receiveShadow;
  into.frustumCulled = node.frustumCulled;
  into.renderOrder = node.renderOrder;
  into.userData = JSON.parse(JSON.stringify(node.userData)) as Record<string, unknown>;
  return into;
}

/** The library's light of an engine light: its kind, colour, strength, reach and cone. */
export function threeLight(light: GraphLight | THREE.Light): THREE.Light {
  if (light instanceof THREE.Light) return light.clone();
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
    made.distance = light.distance!;
    made.decay = light.decay!;
  }
  if (made instanceof THREE.SpotLight) {
    made.angle = light.angle!;
    made.penumbra = light.penumbra!;
  }
  if ((made instanceof THREE.DirectionalLight || made instanceof THREE.SpotLight) && light.target)
    place(made.target, light.target);
  return made;
}

/** A node of the library for one engine node, of the same kind, its children not included. */
function threeNode(node: GraphNode): THREE.Object3D {
  const as = node as unknown as {
    isMesh?: boolean;
    isLight?: boolean;
    isCamera?: boolean;
  } & Partial<GraphMesh>;
  if (as.isMesh) {
    const mesh = threeMeshCopy(node as GraphMesh);
    if (as.morphTargetInfluences) mesh.morphTargetInfluences = as.morphTargetInfluences.slice();
    if (as.morphTargetDictionary) mesh.morphTargetDictionary = { ...as.morphTargetDictionary };
    return place(mesh, node);
  }
  if (as.isLight) {
    const light = threeLight(node as GraphLight);
    // The target is a node of the graph: the copy of the graph places it, not the light.
    if ('target' in light) (light as THREE.DirectionalLight).target = new THREE.Object3D();
    return light;
  }
  if (as.isCamera) return place(threeCameraOf(node as GraphCamera), node);
  return place(
    (node as { isGroup?: boolean }).isGroup ? new THREE.Group() : new THREE.Object3D(),
    node,
  );
}

/**
 * The library's copy of a whole engine graph: every node of the same kind, pose and name, the
 * resources shared as the engine shares them, and each light aiming at the copy of its target.
 */
export function threeGraph(root: GraphNode | THREE.Object3D): THREE.Object3D {
  if (root instanceof THREE.Object3D) return root;
  const copies = new Map<GraphNode, THREE.Object3D>();
  const copy = (node: GraphNode): THREE.Object3D => {
    const made = threeNode(node);
    copies.set(node, made);
    for (const child of node.children) made.add(copy(child));
    return made;
  };
  const made = copy(root);
  for (const [node, light] of copies) {
    const target = (node as GraphLight).target;
    if ((node as GraphLight).isLight && target)
      (light as THREE.DirectionalLight).target =
        copies.get(target) ?? place(new THREE.Object3D(), target);
  }
  return made;
}

/** A library camera of the engine camera's kind, at its optics. */
function threeCameraOf(camera: GraphCamera) {
  const made = camera.frame
    ? new THREE.OrthographicCamera(
        camera.frame.left,
        camera.frame.right,
        camera.frame.top,
        camera.frame.bottom,
        camera.near,
        camera.far,
      )
    : new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  made.zoom = camera.zoom;
  made.updateProjectionMatrix();
  return made;
}

/**
 * The library's camera for an engine camera, brought to the engine camera's world pose and
 * optics at each call: the renderer composes its view from the world matrix the engine resolved,
 * and its projection from the same optics. A library camera crosses as it is.
 */
export function threeCamera(camera: GraphCamera | THREE.Camera): THREE.Camera {
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
  } else if (camera.frame) Object.assign(made, camera.frame);
  made.updateProjectionMatrix();
  made.updateMatrixWorld();
  return made;
}
