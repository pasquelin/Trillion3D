import * as THREE from 'three';
import { setGeometryBounds } from './threeBounds.ts';
import type { GeometryPageDescriptor } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';

type GeometryEnvironment = {
  scene: THREE.Scene;
  allPages: PageRec[];
  bootstrap: PageRec[];
  shown: PageRec[];
  desired: PageRec[];
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  baseMaterials: Map<PageRec, THREE.Material | THREE.Material[]>;
  colorMaterials: Map<THREE.Material, THREE.Material>;
  modifiedPages: Set<string>;
};

export function createAutonomousGeometry(env: GeometryEnvironment) {
  const {
    scene,
    allPages,
    bootstrap,
    shown,
    desired,
    byUrl,
    descriptors,
    baseMaterials,
    colorMaterials,
    modifiedPages,
  } = env;
  const state = { allocationBytes: 0, submittedTriangles: 0 };
  // The set of displayed pages, reused from frame to frame rather than rebuilt.
  const affichees = new Set<PageRec>();
  // Pages actually attached to the scene, held by `attach` and `detach`. A frame detaches
  // only a delta bounded by the cut: it no longer has to scan the whole DAG to find it.
  const attachees = new Set<PageRec>();
  const detach = (rec: PageRec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      rec.attached = false;
      attachees.delete(rec);
    }
  };
  const attach = (rec: PageRec) => {
    if (!rec.geometry) return;
    if (!rec.mesh) {
      const mesh = new THREE.Mesh(rec.geometry, rec.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = rec.renderOrder;
      rec.mesh = mesh;
    }
    rec.mesh.matrix.copy(rec.matrix);
    if (!rec.attached) {
      scene.add(rec.mesh);
      rec.attached = true;
      attachees.add(rec);
    }
  };
  const sync = () => {
    const display = shown;
    affichees.clear();
    for (const rec of display) affichees.add(rec);
    // Removing the current element of a `Set` while iterating it is defined: it will not be revisited.
    for (const rec of attachees) if (!affichees.has(rec)) detach(rec);
    state.submittedTriangles = 0;
    for (const rec of display) {
      if (!rec.array) throw new Error('AUTONOMOUS_COVERAGE_MISSING');
      attach(rec);
      state.submittedTriangles += rec.triangles;
    }
  };
  const geometryBytes = (geometry: THREE.BufferGeometry) => {
    let bytes = geometry.getIndex()?.array.byteLength ?? 0;
    for (const attr of Object.values(geometry.attributes)) bytes += attr.array.byteLength;
    return bytes;
  };
  const removeRecords = (records: PageRec[]) => {
    const removed = new Set(records);
    for (const rec of records) {
      detach(rec);
      if (rec.geometry) {
        state.allocationBytes -= geometryBytes(rec.geometry);
        rec.geometry.dispose();
      }
      rec.geometry = undefined;
      rec.mesh = undefined;
      rec.array = undefined;
      const list = byUrl.get(rec.url);
      if (list) {
        const index = list.indexOf(rec);
        if (index >= 0) list.splice(index, 1);
      }
      baseMaterials.delete(rec);
    }
    for (const list of [allPages, bootstrap, shown, desired])
      for (let i = list.length - 1; i >= 0; i--) if (removed.has(list[i])) list.splice(i, 1);
  };
  const storeGeometryPage = (url: string, data: DecodedGeometryPage) => {
    const recs = byUrl.get(url);
    if (!recs) return;
    const descriptor = descriptors.get(url);
    if (
      !descriptor ||
      data.vertexCount !== descriptor.vertexCount ||
      data.indices.length !== descriptor.indexCount ||
      data.flags !== descriptor.flags
    )
      throw new Error('AUTONOMOUS_PAGE_METADATA_MISMATCH');
    for (const rec of recs) {
      detach(rec);
      if (rec.geometry) {
        state.allocationBytes -= rec.geometry.getIndex()?.array.byteLength ?? 0;
        for (const attr of Object.values(rec.geometry.attributes))
          state.allocationBytes -= attr.array.byteLength;
        rec.geometry.dispose();
      }
      const positions = data.attributes.position,
        slack = 1e-5 + (descriptor.positionError ?? 0);
      for (let i = 0; i < positions.length; i++) {
        const axis = i % 3;
        if (positions[i] < rec.min[axis] - slack || positions[i] > rec.max[axis] + slack)
          throw new Error('AUTONOMOUS_PAGE_BOUNDS');
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      for (const [name, array] of Object.entries(data.attributes))
        geometry.setAttribute(
          name,
          new THREE.BufferAttribute(
            array,
            name === 'position' || name === 'normal' ? 3 : name === 'color' ? 4 : 2,
          ),
        );
      setGeometryBounds(geometry, rec.min, rec.max);
      const original = baseMaterials.get(rec)!;
      rec.material = data.attributes.color
        ? Array.isArray(original)
          ? original.map((material) => {
              let clone = colorMaterials.get(material);
              if (!clone) {
                clone = material.clone();
                (clone as THREE.MeshStandardMaterial).vertexColors = true;
                colorMaterials.set(material, clone);
              }
              return clone;
            })
          : (() => {
              let clone = colorMaterials.get(original);
              if (!clone) {
                clone = original.clone();
                (clone as THREE.MeshStandardMaterial).vertexColors = true;
                colorMaterials.set(original, clone);
              }
              return clone;
            })()
        : original;
      rec.array = data.indices;
      rec.attributes = geometry.attributes;
      rec.geometry = geometry;
      rec.mesh = undefined;
      state.allocationBytes += data.indices.byteLength;
      for (const array of Object.values(data.attributes)) state.allocationBytes += array.byteLength;
    }
  };
  const acceptGeometryPage = (url: string, data: DecodedGeometryPage) => {
    if (!modifiedPages.has(url)) storeGeometryPage(url, data);
  };
  return {
    state,
    detach,
    sync,
    geometryBytes,
    removeRecords,
    storeGeometryPage,
    acceptGeometryPage,
  };
}
