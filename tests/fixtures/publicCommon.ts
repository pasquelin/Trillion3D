import {
  HIERARCHY_ROOT,
  createSceneRoot,
  hierarchyUpdateBatch,
  type CameraPose,
  type JobSnapshot,
  type SceneNode,
  type SceneNodeOptions,
  type SceneRoot,
  type SceneState,
  type TransportOptions,
  type TransportResult,
} from 'trillion3d';

export const home: CameraPose = {
  position: [2, 1, 2],
  target: [0, 0, 0],
  fov: 55,
  near: 0.1,
  far: 100,
};
export const statusOf = <T>(snapshot: JobSnapshot<T>) => snapshot.status;
export const transportOptions: TransportOptions = {
  onProgress: (progress) => progress.completed / progress.total,
};
export const transportIterations = (result: TransportResult) => result.iterations;
const sceneOptions: SceneNodeOptions = { id: 'typed-root' };
const scene: SceneRoot = createSceneRoot(sceneOptions);
const child: SceneNode = scene.createNode({ id: 'typed-child' });
export const sceneRootOf = (state: SceneState) => state.root;

// @ts-expect-error Camera vectors have exactly three coordinates.
const invalidPose: CameraPose = { ...home, position: [0, 1] };

export const commonContract = {
  HIERARCHY_ROOT,
  child,
  hierarchyUpdateBatch,
  invalidPose,
  scene,
};
