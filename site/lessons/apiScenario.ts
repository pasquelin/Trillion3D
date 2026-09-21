import { examples } from '../content/catalog.ts';

const related: Record<string, string> = {
  'example-camera': 'perspective',
  'example-batch': 'hierarchy',
  createCameraFrame: 'frustum',
  updateCameraFrame: 'frustum',
  frustumFarPlane: 'frustum',
  frustumExcludesBox: 'frustum',
  boxConeRejects: 'frustum',
  boxUnion: 'box-grow',
  boxTransform: 'sphere-from-box',
  boxTransformBatch: 'sphere-from-box',
  multiplyMatrix4Batch: 'matrix-chain',
  hierarchyUpdateBatch: 'hierarchy',
  updateNodeMatrixWorld: 'hierarchy',
  reparentTransformNode: 'hierarchy',
  scaleVector3: 'normalize',
  transformDirectionVector3: 'cross-product',
};
const relatedSection: Record<string, string> = {
  camera: 'perspective',
  host: 'perspective',
  matrices: 'compose-transform',
  vectors: 'normalize',
  colors: 'color-space',
  bounds: 'box-grow',
  tree: 'hierarchy',
};

export function apiScenario(id: string, section: string): string {
  return (
    examples.find((example) => example.functions?.includes(id))?.id ??
    related[id] ??
    relatedSection[section]
  );
}
