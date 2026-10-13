import type { ExportEntry, ExportRow } from './sdk-api-model.ts'

function gap(name: string, kind: 'value' | 'type', module: string, entry: ExportEntry): ExportRow {
  return {
    name,
    kind,
    module,
    entries: [entry],
    identity: `documented:${module}:${name}`,
    disposition: 'newly exposed',
  }
}

export const DOCUMENTED_GAPS: ExportRow[] = [
  gap('CameraOptics', 'type', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('COLUMN_KIND', 'value', 'packages/sdk-core/src/manifest/binaryFormat.ts', 'core'),
  gap('ColumnKind', 'type', 'packages/sdk-core/src/manifest/binaryFormat.ts', 'core'),
  gap('EngineCamera', 'type', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('HostCamera', 'type', 'packages/sdk-browser/src/camera/world.ts', 'browser'),
  gap('SINGULAR_DETERMINANT', 'value', 'packages/math/src/matrix/singular.ts', 'core'),
  gap('adjugateFactor', 'value', 'packages/math/src/matrix/singular.ts', 'core'),
  gap('createEngineCamera', 'value', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('defaultEngineCamera', 'value', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('enginePose', 'value', 'packages/sdk-browser/src/camera/world.ts', 'browser'),
  gap('holdCameraWorld', 'value', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('OrthographicBox', 'type', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
  gap('materialSide', 'value', 'packages/sdk-browser/src/scene/materialSide.ts', 'browser'),
  gap('normalizedLinearDeterminant', 'value', 'packages/math/src/matrix/singular.ts', 'core'),
  gap('readCameraWorld', 'value', 'packages/sdk-browser/src/camera/world.ts', 'browser'),
  gap('sideOf', 'value', 'packages/sdk-browser/src/scene/materialSide.ts', 'browser'),
  gap('writeEngineCamera', 'value', 'packages/sdk-browser/src/camera/engineCamera.ts', 'browser'),
]
