import { multiplyMatrix4, type Material } from '../sdk-core/index.ts';
import type { HostMaterial, HostMaterials } from './hostResources.ts';
import {
  copyHostGeometry,
  hostPageBytes,
  hostPageSurface,
  releaseHostSurface,
  setHostPose,
  setHostSurface,
  colouredTwin,
} from './hostPageObjects.ts';
import { surfaceOf } from './pageSurface.ts';
import { copyElements, type HostNodeMatrix, type MatrixElements } from './matrixElements.ts';
import type { PageRec, ClusterRoot } from './pageSelection.ts';
import type { createAutonomousGeometry } from './autonomousGeometry.ts';

type InstanceEnvironment = {
  roots: ClusterRoot<PageRec>[];
  baseRoots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  basePages: PageRec[];
  bootstrap: PageRec[];
  baseBootstrap: PageRec[];
  byUrl: Map<string, PageRec[]>;
  baseMaterials: Map<PageRec, HostMaterials>;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  cap: number;
  /** Notified by every entry point that writes the scene: that is where the origin is. */
  sceneChanged: () => void;
};

/** The two buffers the composition works in, allocated once: the core multiplies `Float64Array`
 *  alone — one caller passing another container makes its forty-eight accesses polymorphic for
 *  every caller — so a model pose is copied in, and the product copied back out. */
const model = new Float64Array(16),
  product = new Float64Array(16);

/** `pose = transform · model`, sixteen floats in and sixteen floats out: no host library
 *  composes anything here, and the result is the one the reference computes, bit for bit.
 *
 *  `pose` is the mutable shape, `from` the read-only one, and the callers pass fields their own
 *  records declare as `MatrixElements`. TypeScript does not weigh `readonly` when it checks
 *  assignability, so that declaration is a statement of intent the compiler will not enforce:
 *  this function is the ONE writer of those sixteen floats, which is why the rest of the page
 *  path can read them as constants. Widening the records themselves would carry a mutable
 *  matrix through the cut, the rows and the raster, to serve one writer. */
function placeInto(pose: HostNodeMatrix, transform: Float64Array, from: MatrixElements) {
  copyElements(model, from.elements);
  multiplyMatrix4(product, transform, model);
  copyElements(pose.elements, product);
}

/** An instance's own copy of a model pose: storage of the engine's, never a host matrix. */
function composedPose(transform: Float64Array, from: MatrixElements): MatrixElements {
  const pose = { elements: new Float64Array(16) };
  placeInto(pose, transform, from);
  return pose;
}

/**
 * Re-places an instance: its roots and pages take back the transform applied to their
 * models. `pages[i]` is the clone of `bases[i]`, set once at creation, where the move
 * used to rebuild a page → base-page hash table on every call.
 */
export function deplaceInstance(
  instance: { pages: PageRec[]; bases: PageRec[]; roots: ClusterRoot<PageRec>[] },
  baseRoots: readonly ClusterRoot<PageRec>[],
  transform: Float64Array,
) {
  const { pages, bases, roots } = instance;
  for (let i = 0; i < roots.length; i++) placeInto(roots[i].world, transform, baseRoots[i].world);
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i];
    placeInto(rec.matrix, transform, bases[i].matrix);
    if (rec.mesh) setHostPose(rec.mesh, rec.matrix);
  }
}

export function createAutonomousInstances(env: InstanceEnvironment) {
  const {
    roots,
    baseRoots,
    allPages,
    basePages,
    bootstrap,
    baseBootstrap,
    byUrl,
    baseMaterials,
    geometryStore,
    cap,
    sceneChanged,
  } = env;
  // `pages[i]` is the clone of `bases[i]`: the pair is set at creation, not rebuilt as a
  // hash table on every instance move.
  const instances = new Map<
    string,
    { roots: ClusterRoot<PageRec>[]; pages: PageRec[]; bases: PageRec[]; bootstrap: PageRec[] }
  >();
  const { removeRecords, sync, colorMaterials } = geometryStore;
  /** The material this engine built from the contract for a primitive, and therefore frees
   *  itself: one entry per repainted primitive, replaced — not stacked — by the next paint. */
  const owned = new Map<string, HostMaterial>();
  /** Frees a paint and the twin the shared cache holds for it: repainting n times keeps one. */
  const releasePaint = (painted: HostMaterial) => {
    const twin = colorMaterials.get(painted);
    if (twin) {
      colorMaterials.delete(painted);
      releaseHostSurface(twin);
    }
    releaseHostSurface(painted);
  };
  return {
    disposeOwnedMaterials() {
      for (const painted of owned.values()) releasePaint(painted);
      owned.clear();
    },
    addInstance(id: string, transform: Float64Array) {
      sceneChanged();
      if (instances.has(id) || !id) throw new Error('AUTONOMOUS_INSTANCE_ID');
      if (bootstrap.length + baseBootstrap.length > cap) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      const mapped = new Map<PageRec, PageRec>();
      for (const base of basePages) {
        const geometry = base.geometry ? copyHostGeometry(base.geometry) : undefined;
        const rec: PageRec = {
          ...base,
          clusterId: `${id}/${base.clusterId}`,
          matrix: composedPose(transform, base.matrix),
          geometry,
          attributes: geometry?.attributes ?? base.attributes,
          mesh: undefined,
          attached: false,
        };
        if (geometry) geometryStore.state.allocationBytes += hostPageBytes(geometry);
        mapped.set(base, rec);
        allPages.push(rec);
        baseMaterials.set(rec, baseMaterials.get(base)!);
        let list = byUrl.get(rec.url);
        if (!list) byUrl.set(rec.url, (list = []));
        list.push(rec);
      }
      const addedRoots = baseRoots.map((root) => ({
        ...root,
        world: composedPose(transform, root.world),
        pages: root.pages.map((page) => mapped.get(page)!),
      }));
      const addedBootstrap = baseBootstrap.map((page) => mapped.get(page)!);
      roots.push(...addedRoots);
      bootstrap.push(...addedBootstrap);
      instances.set(id, {
        roots: addedRoots,
        pages: [...mapped.values()],
        bases: [...basePages],
        bootstrap: addedBootstrap,
      });
    },
    updateInstance(id: string, transform: Float64Array) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      deplaceInstance(instance, baseRoots, transform);
    },
    removeInstance(id: string) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      const removed = new Set(instance.roots);
      for (let i = roots.length - 1; i >= 0; i--) if (removed.has(roots[i])) roots.splice(i, 1);
      removeRecords(instance.pages);
      instances.delete(id);
      sync();
    },
    updateMaterial(primitive: string, material: Material) {
      sceneChanged();
      const records = allPages.filter(
        (rec) =>
          rec.clusterId.startsWith(`${primitive}/`) || rec.clusterId.includes(`/${primitive}/`),
      );
      if (!records.length) throw new Error('AUTONOMOUS_PRIMITIVE_MISSING');
      // Two host materials at most, built once for the whole primitive: the plain one, and the
      // vertex-coloured twin a page with a colour attribute draws with, taken from the shared
      // cache the decoded pages read. The paint this one replaces is freed below.
      const previous = owned.get(primitive);
      const painted = hostPageSurface(material, false);
      owned.set(primitive, painted);
      const coloured = records.some((rec) => rec.attributes.color)
        ? colouredTwin(colorMaterials, painted)
        : painted;
      for (const rec of records) {
        baseMaterials.set(rec, painted);
        rec.declaration = rec.attributes.color ? coloured : painted;
        rec.material = surfaceOf(rec.declaration);
        if (rec.mesh) setHostSurface(rec.mesh, rec.declaration);
      }
      if (previous) releasePaint(previous);
    },
  };
}
