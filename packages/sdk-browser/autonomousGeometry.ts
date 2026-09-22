import {
  colouredHostSurface,
  hostPageBytes,
  hostPageGeometry,
  hostPageMesh,
  releaseHostGeometry,
  setHostPose,
} from './hostPageObjects.ts';
import { surfaceOf } from './pageSurface.ts';
import { EngineError, type GeometryPageDescriptor } from '../sdk-core/index.ts';
import type { HostMaterial, HostMaterials } from './hostResources.ts';
import type { HostDrawScene } from './hostGraphNodes.ts';
import type { PageRec } from './pageSelection.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';

type GeometryEnvironment = {
  scene: HostDrawScene;
  allPages: PageRec[];
  bootstrap: PageRec[];
  shown: PageRec[];
  desired: PageRec[];
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  baseMaterials: Map<PageRec, HostMaterials>;
  colorMaterials: Map<HostMaterial, HostMaterial>;
  modifiedPages: Set<string>;
};

/**
 * Frees the host geometry a page record holds and gives its bytes back to the store. The one
 * place that releases a page's geometry: the store and the residency both call it.
 */
export function releaseGeometry(state: { allocationBytes: number }, rec: PageRec) {
  if (!rec.geometry) return;
  state.allocationBytes -= hostPageBytes(rec.geometry);
  releaseHostGeometry(rec.geometry);
}

/** Components of a decoded attribute, by name; anything else is a UV pair. */
const ITEM_SIZE: Record<string, number> = { position: 3, normal: 3, color: 4 };
const itemSize = (name: string) => ITEM_SIZE[name] ?? 2;

/**
 * The vertex-coloured twin of a host surface: cloned once, then read from the shared cache.
 * The only place a twin is built — a page that decodes a colour attribute and a primitive the
 * host repaints ask the same cache, so one surface never holds two of them.
 */
export function colouredTwin(
  cache: Map<HostMaterial, HostMaterial>,
  original: HostMaterial,
): HostMaterial {
  let twin = cache.get(original);
  if (!twin) {
    twin = colouredHostSurface(original);
    cache.set(original, twin);
  }
  return twin;
}

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
    // The host declaration, not the engine's surface record: the record has no `visible`
    // flag, and the host library silently drops every mesh whose material lacks one.
    rec.mesh ??= hostPageMesh(rec.geometry, rec.declaration, rec.renderOrder);
    setHostPose(rec.mesh, rec.matrix);
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
      if (!rec.array)
        throw new EngineError(
          'AUTONOMOUS_COVERAGE_MISSING',
          'The prepared autonomous scene does not cover every page the cut requires',
          { page: rec.url },
        );
      attach(rec);
      state.submittedTriangles += rec.triangles;
    }
  };
  const removeRecords = (records: PageRec[]) => {
    const removed = new Set(records);
    for (const rec of records) {
      detach(rec);
      releaseGeometry(state, rec);
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
      releaseGeometry(state, rec);
      // A decoded position may leave the source box by the page's own quantization error.
      const positions = data.attributes.position,
        slack = 1e-5 + data.quantizationError;
      for (let i = 0; i < positions.length; i++) {
        const axis = i % 3;
        if (positions[i] < rec.min[axis] - slack || positions[i] > rec.max[axis] + slack)
          throw new Error('AUTONOMOUS_PAGE_BOUNDS');
      }
      const geometry = hostPageGeometry(data, itemSize, rec.min, rec.max);
      const base = baseMaterials.get(rec)!;
      // Lazily: a page without a colour attribute must not make a vertex-coloured twin.
      const twin = (one: HostMaterial) => colouredTwin(colorMaterials, one);
      const paint = () => (Array.isArray(base) ? base.map(twin) : twin(base));
      rec.declaration = data.attributes.color ? paint() : base;
      rec.material = surfaceOf(rec.declaration);
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
    /** The one twin cache of the backend: whoever paints a surface reads it through here. */
    colorMaterials,
    detach,
    sync,
    removeRecords,
    storeGeometryPage,
    acceptGeometryPage,
  };
}
