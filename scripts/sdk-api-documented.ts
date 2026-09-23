import type { ExportEntry, ExportRow } from './sdk-api-model.ts';

function gap(
  name: string,
  kind: 'value' | 'type',
  module: string,
  entry: ExportEntry,
  consumer: string,
): ExportRow {
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

const CAMERA = 'site/content/entries/camera.ts';
const ENUMS = 'site/content/entries/enumsRuntime.ts';
const MATRIX = 'site/content/entries/matrix.ts';

export const DOCUMENTED_GAPS: ExportRow[] = [
  gap('CameraOptics', 'type', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser', CAMERA),
  gap('COLUMN_KIND', 'value', 'packages/sdk-core/src/manifest/binaryFormat.ts', 'core', ENUMS),
  gap('ColumnKind', 'type', 'packages/sdk-core/src/manifest/binaryFormat.ts', 'core', ENUMS),
  gap('EngineCamera', 'type', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser', CAMERA),
  gap('HostCamera', 'type', 'packages/sdk-browser/src/camera/world.ts', 'browser', CAMERA),
  gap('PATH_EXPLORE_EVERY', 'value', 'packages/sdk-core/src/math/path/governor.ts', 'core', ENUMS),
  gap('PATH_MIN_SAMPLES', 'value', 'packages/sdk-core/src/math/path/governor.ts', 'core', ENUMS),
  gap('PATH_SWITCH_RUNS', 'value', 'packages/sdk-core/src/math/path/governor.ts', 'core', ENUMS),
  gap(
    'SINGULAR_DETERMINANT',
    'value',
    'packages/sdk-core/src/math/matrix/singular.ts',
    'core',
    MATRIX,
  ),
  gap('adjugateFactor', 'value', 'packages/sdk-core/src/math/matrix/singular.ts', 'core', MATRIX),
  gap(
    'createEngineCamera',
    'value',
    'packages/sdk-browser/src/camera/engineCamera.ts',
    'browser',
    CAMERA,
  ),
  gap(
    'defaultEngineCamera',
    'value',
    'packages/sdk-browser/src/camera/engineCamera.ts',
    'browser',
    CAMERA,
  ),
  gap('enginePose', 'value', 'packages/sdk-browser/src/camera/world.ts', 'browser', CAMERA),
  gap(
    'holdCameraWorld',
    'value',
    'packages/sdk-browser/src/camera/engineCamera.ts',
    'browser',
    CAMERA,
  ),
  gap(
    'OrthographicBox',
    'type',
    'packages/sdk-browser/src/camera/engineCamera.ts',
    'browser',
    CAMERA,
  ),
  gap('materialSide', 'value', 'packages/sdk-browser/src/scene/materialSide.ts', 'browser', ENUMS),
  gap(
    'normalizedLinearDeterminant',
    'value',
    'packages/sdk-core/src/math/matrix/singular.ts',
    'core',
    MATRIX,
  ),
  gap('readCameraWorld', 'value', 'packages/sdk-browser/src/camera/world.ts', 'browser', CAMERA),
  gap('sideOf', 'value', 'packages/sdk-browser/src/scene/materialSide.ts', 'browser', ENUMS),
  gap(
    'writeEngineCamera',
    'value',
    'packages/sdk-browser/src/camera/engineCamera.ts',
    'browser',
    CAMERA,
  ),
];
