// A minimal `PageRec` fixture shared by benches that only exercise a handful of its fields
// (residency, streaming, shadow spheres): the rest are shared constants, allocated once, never
// read by the timed loop, so filling them costs nothing the bench's own numbers could move.
import * as THREE from 'three';
import type { PageRec } from '../../pageSelectionTypes.ts';
import { surfaceOf } from '../../pageSurface.ts';

const DUMMY_ATTRIBUTES: THREE.BufferGeometry['attributes'] = {};
const IDENTITY_MATRIX = new THREE.Matrix4();
const DUMMY_BOUNDS: number[] = [0, 0, 0];

export function pageRecFixture(fields: Partial<PageRec> = {}): PageRec {
  return {
    id: 0,
    url: '',
    clusterId: '',
    triangles: 0,
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    attributes: DUMMY_ATTRIBUTES,
    material: surfaceOf([]),
    declaration: [],
    matrix: IDENTITY_MATRIX,
    renderOrder: 0,
    attached: false,
    ...fields,
  };
}
