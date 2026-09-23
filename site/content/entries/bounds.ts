import type { EntryNote } from '../model.ts';

/** Boxes, spheres, frustums and cones: what decides, per frame, whether a cluster is drawn. */

export const BOUNDS: EntryNote[] = [
  {
    id: 'boxUnion',
    replaces: 'Box3.makeEmpty, isEmpty, expandByPoint, union',
  },
  {
    id: 'boxTransform',
    replaces: 'Box3.applyMatrix4',
  },
  {
    id: 'sphereFromBounds',
    replaces: 'Box3.getBoundingSphere',
  },
  {
    id: 'frustumPlanesFromMatrix',
    replaces: 'Frustum.setFromProjectionMatrix',
    proof: 'bench Frustum.setFromProjectionMatrix (×1.6 on the side planes)',
  },
  {
    id: 'frustumFarPlane',
  },
  {
    id: 'frustumExcludesBox',
    replaces: 'Frustum.intersectsBox',
  },
  {
    id: 'boxConeRejects',
  },
];
