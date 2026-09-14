import * as THREE from 'three';
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
  baseMaterials: Map<PageRec, THREE.Material | THREE.Material[]>;
  colorMaterials: Map<THREE.Material, THREE.Material>;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  cap: number;
};

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
    colorMaterials,
    geometryStore,
    cap,
  } = env;
  const instances = new Map<
    string,
    { roots: ClusterRoot<PageRec>[]; pages: PageRec[]; bootstrap: PageRec[] }
  >();
  const { geometryBytes, removeRecords, sync } = geometryStore;
  return {
    addInstance(id: string, transform: THREE.Matrix4) {
      if (instances.has(id) || !id) throw new Error('AUTONOMOUS_INSTANCE_ID');
      if (bootstrap.length + baseBootstrap.length > cap) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      const mapped = new Map<PageRec, PageRec>();
      for (const base of basePages) {
        const geometry = base.geometry?.clone();
        const rec: PageRec = {
          ...base,
          clusterId: `${id}/${base.clusterId}`,
          matrix: transform.clone().multiply(base.matrix),
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
        world: transform.clone().multiply(root.world),
        pages: root.pages.map((page) => mapped.get(page)!),
      }));
      const addedBootstrap = baseBootstrap.map((page) => mapped.get(page)!);
      roots.push(...addedRoots);
      bootstrap.push(...addedBootstrap);
      instances.set(id, {
        roots: addedRoots,
        pages: [...mapped.values()],
        bootstrap: addedBootstrap,
      });
    },
    updateInstance(id: string, transform: THREE.Matrix4) {
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      const mapped = new Map(basePages.map((base, i) => [instance.pages[i], base] as const));
      for (let i = 0; i < instance.roots.length; i++)
        instance.roots[i].world.copy(transform).multiply(baseRoots[i].world);
      for (const rec of instance.pages) {
        rec.matrix.copy(transform).multiply(mapped.get(rec)!.matrix);
        if (rec.mesh) rec.mesh.matrix.copy(rec.matrix);
      }
    },
    removeInstance(id: string) {
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      const removed = new Set(instance.roots);
      for (let i = roots.length - 1; i >= 0; i--) if (removed.has(roots[i])) roots.splice(i, 1);
      removeRecords(instance.pages);
      instances.delete(id);
      sync();
    },
    updateMaterial(primitive: string, material: THREE.Material) {
      const records = allPages.filter(
        (rec) =>
          rec.clusterId.startsWith(`${primitive}/`) || rec.clusterId.includes(`/${primitive}/`),
      );
      if (!records.length) throw new Error('AUTONOMOUS_PRIMITIVE_MISSING');
      for (const rec of records) {
        baseMaterials.set(rec, material);
        rec.material = rec.attributes.color
          ? (() => {
              let clone = colorMaterials.get(material);
              if (!clone) {
                clone = material.clone();
                (clone as THREE.MeshStandardMaterial).vertexColors = true;
                colorMaterials.set(material, clone);
              }
              return clone;
            })()
          : material;
        if (rec.mesh) rec.mesh.material = rec.material;
      }
    },
  };
}
