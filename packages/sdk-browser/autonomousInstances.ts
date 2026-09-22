import { surfaceOf } from './pageSurface.ts';
import * as THREE from 'three';
import type { Material } from '../sdk-core/index.ts';
import { asHostLibrary, type HostMaterials } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { PageRec, ClusterRoot } from './pageSelection.ts';
import { colouredTwin, type createAutonomousGeometry } from './autonomousGeometry.ts';

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
  const place = (pose: MatrixElements, base: MatrixElements) =>
    asHostLibrary<THREE.Matrix4>(pose)
      .fromArray(transform)
      .multiply(asHostLibrary<THREE.Matrix4>(base));
  for (let i = 0; i < roots.length; i++) place(roots[i].world, baseRoots[i].world);
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i];
    place(rec.matrix, bases[i].matrix);
    if (rec.mesh) asHostLibrary<THREE.Mesh>(rec.mesh).matrix.fromArray(rec.matrix.elements);
  }
}

/** The engine's material parameters, given back to the witness's own rendering library. */
function hostMaterialOf(material: Material, vertexColors: boolean) {
  const side =
    material.side === 'double'
      ? THREE.DoubleSide
      : material.side === 'back'
        ? THREE.BackSide
        : THREE.FrontSide;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(...material.baseColor),
    emissive: new THREE.Color(...material.emissive),
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    transparent: material.alphaMode === 'blend',
    alphaTest: material.alphaMode === 'mask' ? material.alphaCutoff : 0,
    side,
    vertexColors,
  });
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
  const { geometryBytes, removeRecords, sync, colorMaterials } = geometryStore;
  /** The material this engine built from the contract for a primitive, and therefore frees
   *  itself: one entry per repainted primitive, replaced — not stacked — by the next paint. */
  const owned = new Map<string, THREE.Material>();
  /** Frees a paint and the twin the shared cache holds for it: repainting n times keeps one. */
  const releasePaint = (painted: THREE.Material) => {
    const twin = colorMaterials.get(painted);
    if (twin) {
      colorMaterials.delete(painted);
      twin.dispose();
    }
    painted.dispose();
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
        const geometry = asHostLibrary<THREE.BufferGeometry | undefined>(base.geometry)?.clone();
        const rec: PageRec = {
          ...base,
          clusterId: `${id}/${base.clusterId}`,
          matrix: new THREE.Matrix4()
            .fromArray(transform)
            .multiply(asHostLibrary<THREE.Matrix4>(base.matrix)),
          geometry,
          attributes: geometry?.attributes ?? base.attributes,
          mesh: undefined,
          attached: false,
        };
        if (geometry) geometryStore.state.allocationBytes += geometryBytes(geometry);
        mapped.set(base, rec);
        allPages.push(rec);
        baseMaterials.set(rec, baseMaterials.get(base)!);
        let list = byUrl.get(rec.url);
        if (!list) byUrl.set(rec.url, (list = []));
        list.push(rec);
      }
      const addedRoots = baseRoots.map((root) => ({
        ...root,
        world: new THREE.Matrix4()
          .fromArray(transform)
          .multiply(asHostLibrary<THREE.Matrix4>(root.world)),
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
      const painted = hostMaterialOf(material, false);
      owned.set(primitive, painted);
      const coloured = records.some((rec) => rec.attributes.color)
        ? colouredTwin(colorMaterials, painted)
        : painted;
      for (const rec of records) {
        baseMaterials.set(rec, painted);
        rec.declaration = rec.attributes.color ? coloured : painted;
        rec.material = surfaceOf(rec.declaration);
        if (rec.mesh)
          asHostLibrary<THREE.Mesh>(rec.mesh).material = asHostLibrary<THREE.Material>(
            rec.declaration,
          );
      }
      if (previous) releasePaint(previous);
    },
  };
}
