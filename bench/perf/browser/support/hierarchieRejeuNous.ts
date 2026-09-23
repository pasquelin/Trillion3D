// Replay of a hierarchy scenario (batch M3a) on the sdk-core hierarchy and camera, operation
// by operation like `hierarchieRejeuThree.ts`, which describes the operations. Same reads, in
// the same order and under the same form: `compare` confronts them with `Object.is`.
import {
  addTransformNode,
  createCameraFrame,
  createTransformTree,
  lookAtNode,
  nodeWorldDirection,
  nodeWorldMirrorsFaces,
  nodeWorldPosition,
  nodeWorldQuaternion,
  nodeWorldScale,
  perspectiveProjection,
  removeTransformNode,
  reparentTransformNode,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  updateCameraFrame,
  updateNodeMatrixWorld,
  updateNodeWorldMatrix,
} from '../../../../packages/sdk-core/src/index.ts';
import type { HierarchyOp, CameraSpec } from './hierarchieScenarios.ts';

interface CameraRuntime {
  spec: CameraSpec;
  projection: Float64Array;
}

const projectionNous = (output: Float64Array, s: CameraSpec) =>
  perspectiveProjection(output, s.fov, s.aspect, s.near, s.zoom);

/** The same operations on the sdk-core hierarchy and camera. */
export function joueNous(scenario: HierarchyOp[]): number[][] {
  const tree = createTransformTree(4),
    noeuds: number[] = [],
    vivants: boolean[] = [],
    cameras: CameraRuntime[] = [],
    sorties: number[][] = [];
  const image = createCameraFrame(),
    lecture = new Float64Array(13);
  scenario.forEach((op, rang) => {
    const n = noeuds[op[1]];
    switch (op[0]) {
      case 'ajoute': {
        const [, id, parent, p, r, s, camera] = op;
        const node = addTransformNode(tree, parent >= 0 ? noeuds[parent] : -1);
        setNodePosition(tree, node, p[0], p[1], p[2]);
        setNodeQuaternion(tree, node, r[0], r[1], r[2], r[3]);
        setNodeScale(tree, node, s[0], s[1], s[2]);
        if (camera) {
          const runtime: CameraRuntime = { spec: camera, projection: new Float64Array(16) };
          projectionNous(runtime.projection, camera);
          cameras[id] = runtime;
        }
        noeuds[id] = node;
        vivants[id] = true;
        break;
      }
      case 'pose':
        if (op[2]) setNodePosition(tree, n, op[2][0], op[2][1], op[2][2]);
        if (op[3]) setNodeQuaternion(tree, n, op[3][0], op[3][1], op[3][2], op[3][3]);
        if (op[4]) setNodeScale(tree, n, op[4][0], op[4][1], op[4][2]);
        break;
      case 'local':
        setNodeLocalMatrix(tree, n, op[2]);
        break;
      case 'auto':
        setNodeAutoUpdate(tree, n, op[2]);
        break;
      case 'rattache':
        reparentTransformNode(tree, n, op[2] < 0 ? -1 : noeuds[op[2]]);
        break;
      case 'retire':
        removeTransformNode(tree, n);
        for (const id of op[2]) vivants[id] = false;
        break;
      case 'maj':
        updateNodeMatrixWorld(tree, n, op[2]);
        break;
      case 'majMonde':
        updateNodeWorldMatrix(tree, n, op[2], op[3]);
        break;
      case 'vise':
        lookAtNode(tree, n, op[2][0], op[2][1], op[2][2], op[3], !!cameras[op[1]]);
        break;
      case 'objectif': {
        const camera = cameras[op[1]];
        camera.spec = { ...camera.spec, ...op[2] };
        projectionNous(camera.projection, camera.spec);
        break;
      }
      case 'lis':
        nodeWorldPosition(lecture, tree, n);
        sorties.push([
          rang,
          ...lecture.subarray(0, 3),
          ...nodeWorldQuaternion(lecture, tree, n).subarray(0, 4),
          ...nodeWorldScale(lecture, tree, n).subarray(0, 3),
          ...nodeWorldDirection(lecture, tree, n, !!cameras[op[1]]).subarray(0, 3),
          nodeWorldMirrorsFaces(tree, n) ? 1 : 0,
          ...tree.worldViews[n],
        ]);
        break;
      case 'image':
        updateNodeMatrixWorld(tree, n);
        updateCameraFrame(
          image,
          cameras[op[1]].projection,
          tree.worldViews[n],
          cameras[op[1]].spec.far,
        );
        sorties.push([
          rang,
          ...cameras[op[1]].projection,
          ...image.view,
          ...image.viewProjection,
          ...image.planes,
        ]);
        break;
      case 'instantane':
        sorties.push([
          rang,
          ...noeuds.flatMap((node, id) => (vivants[id] ? [...tree.worldViews[node]] : [])),
        ]);
        break;
    }
  });
  return sorties;
}
