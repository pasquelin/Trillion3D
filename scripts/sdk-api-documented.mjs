function gap(name, kind, module, entry, consumer) {
  return {
    name,
    kind,
    module,
    entries: [entry],
    identity: `documented:${module}:${name}`,
    disposition: 'newly exposed',
    consumers: [consumer],
  };
}

const CAMERA = 'docs/js/docsContentCamera.js';
const ENUMS = 'docs/js/docsContentEnumsRuntime.js';
const MATRIX = 'docs/js/docsContentMatrix.js';

export const DOCUMENTED_GAPS = [
  gap('CameraOptics', 'type', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
  gap('COLUMN_KIND', 'value', 'packages/sdk-core/manifestBinaryFormat.ts', 'core', ENUMS),
  gap('ColumnKind', 'type', 'packages/sdk-core/manifestBinaryFormat.ts', 'core', ENUMS),
  gap('EngineCamera', 'type', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
  gap('HostCamera', 'type', 'packages/sdk-browser/cameraWorld.ts', 'browser', CAMERA),
  gap('PATH_EXPLORE_EVERY', 'value', 'packages/sdk-core/mathPathGovernor.ts', 'core', ENUMS),
  gap('PATH_MIN_SAMPLES', 'value', 'packages/sdk-core/mathPathGovernor.ts', 'core', ENUMS),
  gap('PATH_SWITCH_RUNS', 'value', 'packages/sdk-core/mathPathGovernor.ts', 'core', ENUMS),
  gap('SINGULAR_DETERMINANT', 'value', 'packages/sdk-core/mathSingular.ts', 'core', MATRIX),
  gap('Side', 'type', 'packages/sdk-browser/materialSide.ts', 'browser', ENUMS),
  gap('adjugateFactor', 'value', 'packages/sdk-core/mathSingular.ts', 'core', MATRIX),
  gap('createEngineCamera', 'value', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
  gap('defaultEngineCamera', 'value', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
  gap('enginePose', 'value', 'packages/sdk-browser/cameraWorld.ts', 'browser', CAMERA),
  gap('holdCameraWorld', 'value', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
  gap('materialSide', 'value', 'packages/sdk-browser/materialSide.ts', 'browser', ENUMS),
  gap('normalizedLinearDeterminant', 'value', 'packages/sdk-core/mathSingular.ts', 'core', MATRIX),
  gap('readCameraWorld', 'value', 'packages/sdk-browser/cameraWorld.ts', 'browser', CAMERA),
  gap('sideOf', 'value', 'packages/sdk-browser/materialSide.ts', 'browser', ENUMS),
  gap('writeEngineCamera', 'value', 'packages/sdk-browser/engineCamera.ts', 'browser', CAMERA),
];
