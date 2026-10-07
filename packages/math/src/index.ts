// Public entry point of the maths package: matrices, vectors, quaternions, colours, boxes,
// frustums, cones, cameras and the batch forms of them. Pure functions; nothing here imports
// outside `packages/math`.
export {
  IDENTITY_MATRIX4,
  copyMatrix4,
  determinantMatrix4,
  linearPartDeterminant,
  multiplyMatrix4,
} from './matrix/matrix4.ts'
export type { NumberSink } from './matrix/matrix4.ts'
export { invertMatrix4 } from './matrix/matrix4Inverse.ts'
export {
  basisMatrix4,
  composeMatrix4,
  decomposeMatrix4,
  uniformScaleMatrix4,
} from './matrix/matrix4Trs.ts'
export { normalMatrix3 } from './matrix/matrix3.ts'
export { SINGULAR_DETERMINANT_WGSL, linearPartScale } from './matrix/singular.ts'
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
} from './vector/vector.ts'
export { hslToLinearRgb, linearToSrgb, srgbToLinear } from './color/color.ts'
export {
  BOX_VALUES,
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from './geometry/box.ts'
export { sphereFromBounds } from './geometry/sphere.ts'
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
} from './batch/batch.ts'
export {
  FRUSTUM_PLANE_VALUES,
  clipPlanesFromMatrix,
  frustumFarPlane,
  frustumPlanesFromMatrix,
} from './geometry/frustum/frustum.ts'
export { frustumClipBox, frustumExcludesBox } from './geometry/frustum/box.ts'
export {
  CONE_LENGTH_RATIO,
  CONE_LENGTH_RATIO_WGSL,
  CONE_ORTHO_EPS,
  CONE_ORTHO_EPS_WGSL,
  HALF_PI_WGSL,
  boxConeRejects,
} from './geometry/cone.ts'
export {
  createCameraFrame,
  orthographicProjection,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from './projection/camera.ts'
export {
  matrixAtRenderOrigin,
  viewToRenderOrigin,
  worldToRenderOrigin,
} from './projection/renderOrigin.ts'
export {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  rotateByQuaternion,
} from './quaternion/quaternion.ts'
// The scalar helpers and the other constants are engine internals, deep-imported by their users;
// only `HALF_PI` was public before they had a home.
export { HALF_PI } from './constants.ts'
