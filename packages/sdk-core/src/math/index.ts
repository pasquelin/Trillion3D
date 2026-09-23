// Public entry point of the math: matrices, vectors, colours, boxes, frustums, transform
// trees and cameras. Grouped here so `../index.ts` stays within the line limit;
// no contract changes, `../index.ts` re-exports this file as-is.
export {
  IDENTITY_MATRIX4,
  copyMatrix4,
  determinantMatrix4,
  linearPartDeterminant,
  multiplyMatrix4,
} from './matrix/matrix4.ts';
export { invertMatrix4 } from './matrix/matrix4Inverse.ts';
export {
  basisMatrix4,
  composeMatrix4,
  decomposeMatrix4,
  uniformScaleMatrix4,
} from './matrix/matrix4Trs.ts';
export { normalMatrix3 } from './matrix/matrix3.ts';
export { SINGULAR_DETERMINANT_WGSL, linearPartScale } from './matrix/singular.ts';
export {
  addScaledVector3,
  applyMatrix3Vector3,
  copyScaledVector3,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  normalizeVector3,
  scaleVector3,
  transformAffinePoint,
  transformDirectionVector3,
  transformHomogeneousPoint,
} from './primitives/vector.ts';
export { hslToLinearRgb, linearToSrgb, srgbToLinear } from './primitives/color.ts';
export {
  BOX_VALUES,
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from './primitives/box.ts';
export { sphereFromBounds } from './primitives/sphere.ts';
export {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  NORMAL_MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  SPHERE_VALUES,
  boxTransformBatch,
  boxTransformUnionBatch,
  boxUnionBatch,
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  frustumKeepsBoxBatch,
  hierarchyUpdateBatch,
  invertMatrix4Batch,
  linearToSrgbBatch,
  multiplyMatrix4Batch,
  normalMatrix3Batch,
  sphereFromBoundsBatch,
  srgbToLinearBatch,
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from './batch/batch.ts';
export {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './path/contracts.ts';
export { createPathGovernor, type PathGovernor } from './path/governor.ts';
export {
  FRUSTUM_PLANE_VALUES,
  clipPlanesFromMatrix,
  frustumFarPlane,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from './frustum/frustum.ts';
export { frustumClipBox, frustumExcludesBox } from './frustum/frustumBox.ts';
export {
  CONE_LENGTH_RATIO,
  CONE_LENGTH_RATIO_WGSL,
  CONE_ORTHO_EPS,
  CONE_ORTHO_EPS_WGSL,
  HALF_PI,
  HALF_PI_WGSL,
  boxConeRejects,
} from './primitives/cone.ts';
export {
  NODE_AUTO_UPDATE,
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  type TransformTree,
} from './transform-tree/transformTree.ts';
export { removeTransformNode, reparentTransformNode } from './transform-tree/structure.ts';
export {
  markNodeWorldNeedsUpdate,
  updateNodeMatrixWorld,
  updateNodeWorldMatrix,
} from './transform-tree/update.ts';
export {
  nodeWorldDirection,
  nodeWorldMirrorsFaces,
  nodeWorldPosition,
  nodeWorldQuaternion,
  nodeWorldScale,
} from './transform-tree/read.ts';
export { lookAtNode } from './transform-tree/lookAt.ts';
export {
  createCameraFrame,
  orthographicProjection,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from './primitives/camera.ts';
export {
  matrixAtRenderOrigin,
  viewToRenderOrigin,
  worldToRenderOrigin,
} from './primitives/renderOrigin.ts';
export {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  rotateByQuaternion,
} from './matrix/quaternion.ts';
