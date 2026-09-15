// Rejeu d'un scénario de hiérarchie (lot M3a) sur de vrais `Object3D` et caméras de Three.js.
// `hierarchieRejeuNous.mjs` rejoue les mêmes opérations dans le même ordre sur la hiérarchie et la
// caméra de sdk-core. Chaque lecture rend un tableau de nombres étiqueté par le rang de l'opération ;
// `compare` confronte les deux côtés avec `Object.is`, composante par composante.
//
// Opérations : `ajoute` (parent, position, quaternion, échelle, caméra ou rien), `pose` (position,
// quaternion, échelle, chacune ou `null`), `local` (matrice locale posée), `auto` (`matrixAutoUpdate`),
// `rattache` (nouveau parent, `-1` pour détacher), `retire` (le nœud et ses descendants, listés),
// `maj` (`updateMatrixWorld(force)`), `majMonde` (`updateWorldMatrix(parents, enfants)`), `vise`
// (`lookAt` avec un haut), `objectif` (nouveaux réglages de caméra), `lis` (lectures monde d'un nœud),
// `image` (vue, vue-projection et plans d'une caméra), `instantane` (matrices monde de tous les vivants).
import * as THREE from 'three';

const systeme = (webgpu) => (webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem);

function regleCameraThree(camera, spec) {
  for (const cle of ['fov', 'aspect', 'left', 'right', 'top', 'bottom', 'near', 'far', 'zoom'])
    if (cle in spec) camera[cle] = spec[cle];
  camera.coordinateSystem = systeme(spec.webgpu);
  camera.updateProjectionMatrix();
}

/** Les opérations sur les objets de Three.js. */
export function joueThree(scenario) {
  const objets = [],
    vivants = [],
    sorties = [];
  const vp = new THREE.Matrix4(),
    tronc = new THREE.Frustum();
  const v = new THREE.Vector3(),
    q = new THREE.Quaternion();
  scenario.forEach((op, rang) => {
    const o = objets[op[1]];
    switch (op[0]) {
      case 'ajoute': {
        const [, , parent, p, r, s, camera] = op;
        const n = !camera
          ? new THREE.Object3D()
          : camera.type === 'perspective'
            ? new THREE.PerspectiveCamera()
            : new THREE.OrthographicCamera();
        if (camera) regleCameraThree(n, camera);
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
        regleCameraThree(o, op[2]);
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
      case 'image':
        o.updateMatrixWorld();
        vp.multiplyMatrices(o.projectionMatrix, o.matrixWorldInverse);
        tronc.setFromProjectionMatrix(vp, systeme(op[2]));
        sorties.push([
          rang,
          ...o.projectionMatrix.elements,
          ...o.matrixWorldInverse.elements,
          ...vp.elements,
          ...tronc.planes.flatMap((plan) => [...plan.normal.toArray(), plan.constant]),
        ]);
        break;
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
