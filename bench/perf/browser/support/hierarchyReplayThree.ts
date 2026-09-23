// Replay of a hierarchy scenario (batch M3a) on real Three.js `Object3D` and cameras.
// `hierarchyReplayEngine.ts` replays the same operations in the same order on the sdk-core
// hierarchy and camera. Each read yields a number array tagged by the operation rank;
// `compare` confronts both sides with `Object.is`, component by component.
//
// Operations: `ajoute` (parent, position, quaternion, scale, camera or none), `pose` (position,
// quaternion, scale, each or `null`), `local` (posed local matrix), `auto` (`matrixAutoUpdate`),
// `rattache` (new parent, `-1` to detach), `retire` (the node and its descendants, listed),
// `maj` (`updateMatrixWorld(force)`), `majMonde` (`updateWorldMatrix(parents, enfants)`), `vise`
// (`lookAt` with an up), `objectif` (new camera settings), `lis` (world reads of a node),
// `image` (view, view-projection and planes of a camera), `instantane` (world matrices of all live nodes).
import * as THREE from 'three';
import type { CameraSpec, HierarchyOp } from './hierarchyScenarios.ts';

const systeme = (webgpu: boolean) =>
  webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;

/**
 * Three's projection carried into the engine convention: REVERSED depth, INFINITE far plane
 * (`depthConvention.ts`). Only the depth row changes — `m10 = 0`, `m14 = near`, that is
 * `ndc = near / distance` — and it is the same whichever clip convention is declared:
 * `makePerspective` only varies those two terms. Everything else stays the Three witness
 * bit-exact: field of view, aspect, zoom and the perspective column.
 */
function projectionMoteur(out: THREE.Matrix4, camera: THREE.PerspectiveCamera) {
  out.copy(camera.projectionMatrix);
  out.elements[10] = 0;
  out.elements[14] = camera.near;
  return out;
}

/**
 * The six frustum planes in the engine convention, built with Three primitives.
 * Reversing depth swaps the NEAR and FAR planes; and far is no longer read from the
 * projection, which no longer has one, but from the view: a point is inside when `far + z >= 0`.
 * A non-finite `far` leaves the plane that infinite projection gives — zero normal, hence
 * non-numeric once normalized, hence rejecting nothing: an unbounded far.
 */
function plansMoteur(tronc: THREE.Frustum, vp: THREE.Matrix4, view: THREE.Matrix4, far: number) {
  tronc.setFromProjectionMatrix(vp, THREE.WebGPUCoordinateSystem);
  const brut = tronc.planes.flatMap((plan) => [...plan.normal.toArray(), plan.constant]);
  const output = [...brut.slice(0, 16), ...brut.slice(20, 24), ...brut.slice(16, 20)];
  if (!Number.isFinite(far)) return output;
  const v = view.elements;
  const loin = new THREE.Plane(new THREE.Vector3(v[2], v[6], v[10]), v[14] + far).normalize();
  output.splice(16, 4, loin.normal.x, loin.normal.y, loin.normal.z, loin.constant);
  return output;
}

const CAMERA_KEYS = ['fov', 'aspect', 'near', 'far', 'zoom'] as const;

function regleCameraThree(camera: THREE.PerspectiveCamera, spec: CameraSpec) {
  for (const cle of CAMERA_KEYS) if (cle in spec) camera[cle] = spec[cle];
  camera.coordinateSystem = systeme(spec.webgpu);
  camera.updateProjectionMatrix();
}

/** The operations on Three.js objects. */
export function joueThree(scenario: HierarchyOp[]): number[][] {
  const objets: THREE.Object3D[] = [],
    vivants: boolean[] = [],
    sorties: number[][] = [];
  const vp = new THREE.Matrix4(),
    proj = new THREE.Matrix4(),
    tronc = new THREE.Frustum();
  const v = new THREE.Vector3(),
    q = new THREE.Quaternion();
  scenario.forEach((op, rang) => {
    const o = objets[op[1]];
    switch (op[0]) {
      case 'ajoute': {
        const [, , parent, p, r, s, camera] = op;
        let n: THREE.Object3D;
        if (camera) {
          const cam = new THREE.PerspectiveCamera();
          regleCameraThree(cam, camera);
          n = cam;
        } else n = new THREE.Object3D();
        n.position.fromArray(p);
        n.quaternion.fromArray(r);
        n.scale.fromArray(s);
        if (parent >= 0) objets[parent].add(n);
        objets[op[1]] = n;
        vivants[op[1]] = true;
        break;
      }
      case 'pose':
        if (op[2]) o.position.fromArray(op[2]);
        if (op[3]) o.quaternion.fromArray(op[3]);
        if (op[4]) o.scale.fromArray(op[4]);
        break;
      case 'local':
        o.matrix.fromArray(op[2]);
        break;
      case 'auto':
        o.matrixAutoUpdate = op[2];
        break;
      case 'rattache':
        if (op[2] < 0) o.removeFromParent();
        else objets[op[2]].add(o);
        break;
      case 'retire':
        o.removeFromParent();
        for (const id of op[2]) vivants[id] = false;
        break;
      case 'maj':
        o.updateMatrixWorld(op[2]);
        break;
      case 'majMonde':
        o.updateWorldMatrix(op[2], op[3]);
        break;
      case 'vise':
        o.up.fromArray(op[3]);
        o.lookAt(op[2][0], op[2][1], op[2][2]);
        break;
      case 'objectif':
        // Invariant kept by the scenario generator: `objectif` only ever targets a camera id.
        regleCameraThree(o as THREE.PerspectiveCamera, op[2]);
        break;
      case 'lis':
        sorties.push([
          rang,
          ...o.getWorldPosition(v).toArray(),
          ...o.getWorldQuaternion(q).toArray(),
          ...o.getWorldScale(v).toArray(),
          ...o.getWorldDirection(v).toArray(),
          o.matrixWorld.determinant() < 0 ? 1 : 0,
          ...o.matrixWorld.elements,
        ]);
        break;
      case 'image': {
        // Invariant kept by the scenario generator: `image` only ever targets a camera id.
        const camera = o as THREE.PerspectiveCamera;
        camera.updateMatrixWorld();
        projectionMoteur(proj, camera);
        vp.multiplyMatrices(proj, camera.matrixWorldInverse);
        sorties.push([
          rang,
          ...proj.elements,
          ...camera.matrixWorldInverse.elements,
          ...vp.elements,
          ...plansMoteur(tronc, vp, camera.matrixWorldInverse, camera.far),
        ]);
        break;
      }
      case 'instantane':
        sorties.push([
          rang,
          ...objets.flatMap((n, id) => (vivants[id] ? n.matrixWorld.elements : [])),
        ]);
        break;
    }
  });
  return sorties;
}
