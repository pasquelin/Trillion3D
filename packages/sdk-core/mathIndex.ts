// Le point d'entrée public du calcul : matrices, vecteurs, couleurs, boîtes, troncs, arbres de
// transformation et caméras. Regroupé ici pour que `index.ts` tienne dans la limite de lignes ;
// aucun contrat ne change, `index.ts` réexporte ce fichier tel quel.
export { determinantMatrix4, linearPartDeterminant, multiplyMatrix4 } from './mathMatrix4.ts';
export { invertMatrix4 } from './mathMatrix4Inverse.ts';
export { composeMatrix4, decomposeMatrix4 } from './mathMatrix4Trs.ts';
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
export { MATRIX_VALUES, boxTransformBatch, multiplyMatrix4Batch } from './mathBatch.ts';
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
export { boxConeRejects } from './mathCone.ts';
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
export { viewToRenderOrigin, worldToRenderOrigin } from './mathRenderOrigin.ts';
