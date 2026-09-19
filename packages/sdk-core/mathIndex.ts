// Public entry point of the math: matrices, vectors, colours, boxes, frustums, transform
// trees and cameras. Grouped here so `index.ts` stays within the line limit;
// no contract changes, `index.ts` re-exports this file as-is.
export {
  IDENTITY_MATRIX4,
  copyMatrix4,
  determinantMatrix4,
  linearPartDeterminant,
  multiplyMatrix4,
} from './mathMatrix4.ts';
export { invertMatrix4 } from './mathMatrix4Inverse.ts';
export {
  basisMatrix4,
  composeMatrix4,
  decomposeMatrix4,
  uniformScaleMatrix4,
} from './mathMatrix4Trs.ts';
export { normalMatrix3 } from './mathMatrix3.ts';
export { SINGULAR_DETERMINANT_WGSL, linearPartScale } from './mathSingular.ts';
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
} from './mathVector.ts';
export { hslToLinearRgb, linearToSrgb, srgbToLinear } from './mathColor.ts';
export {
  BOX_VALUES,
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from './mathBox.ts';
export { sphereFromBounds } from './mathSphere.ts';
export {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  boxTransformBatch,
  hierarchyUpdateBatch,
  multiplyMatrix4Batch,
} from './mathBatch.ts';
export {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './mathPathContracts.ts';
export { createPathGovernor, type PathGovernor } from './mathPathGovernor.ts';
export {
  FRUSTUM_PLANE_VALUES,
  clipPlanesFromMatrix,
  frustumFarPlane,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from './mathFrustum.ts';
export { frustumClipBox, frustumExcludesBox } from './mathFrustumBox.ts';
export {
  CONE_LENGTH_RATIO,
  CONE_LENGTH_RATIO_WGSL,
  CONE_ORTHO_EPS,
  CONE_ORTHO_EPS_WGSL,
  HALF_PI,
  HALF_PI_WGSL,
  boxConeRejects,
} from './mathCone.ts';
export {
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  type TransformTree,
} from './mathTransformTree.ts';
export { removeTransformNode, reparentTransformNode } from './mathTransformTreeStructure.ts';
export { updateNodeMatrixWorld, updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';
export {
  nodeWorldDirection,
  nodeWorldMirrorsFaces,
  nodeWorldPosition,
  nodeWorldQuaternion,
  nodeWorldScale,
} from './mathTransformTreeRead.ts';
export { lookAtNode } from './mathTransformTreeLookAt.ts';
export {
  createCameraFrame,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from './mathCamera.ts';
export {
  matrixAtRenderOrigin,
  viewToRenderOrigin,
  worldToRenderOrigin,
} from './mathRenderOrigin.ts';
