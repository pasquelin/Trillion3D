/** The surfaces the WebGL2 page path gives a primitive's records inside the session: a paint it
 *  builds from the contract (`updateMaterial`) and frees itself, or a surface the page created
 *  and assigned (`wearSurface`, #847), which its owner keeps. */
import type { Material } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from '../../host/resources.ts';
import {
  hostPageSurface,
  releaseHostSurface,
  setHostSurface,
  colouredTwin,
} from '../../host/pageObjects.ts';
import { recordsBySurface, wearDeclaration } from '../../page/surface.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { SurfaceAssignment } from '../../placement/backendSceneUpdates.ts';

type PaintEnvironment = {
  allPages: PageRec[];
  baseMaterials: Map<PageRec, HostMaterials>;
  /** The one twin cache of the backend (`geometry.ts`). */
  colorMaterials: Map<HostMaterial, HostMaterial>;
  /** Notified by every entry point that writes the scene: that is where the origin is. */
  sceneChanged: () => void;
};

export function createAutonomousPaints(env: PaintEnvironment) {
  const { allPages, baseMaterials, colorMaterials, sceneChanged } = env;
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
  /** Records wear `painted`, or the vertex-coloured twin a page with a colour attribute draws
   *  with, taken from the shared cache the decoded pages read; `dress` gives another rule. */
  const wear = (
    records: readonly PageRec[],
    painted: HostMaterial,
    dress = (rec: PageRec) =>
      rec.attributes.color ? colouredTwin(colorMaterials, painted) : painted,
  ) => {
    for (const rec of records) {
      baseMaterials.set(rec, painted);
      wearDeclaration(rec, dress(rec));
      if (rec.mesh) setHostSurface(rec.mesh, rec.declaration);
    }
  };
  return {
    disposeOwnedMaterials() {
      for (const painted of owned.values()) releasePaint(painted);
      owned.clear();
    },
    updateMaterial(primitive: string, material: Material) {
      sceneChanged();
      const records = allPages.filter(
        (rec) =>
          rec.clusterId.startsWith(`${primitive}/`) || rec.clusterId.includes(`/${primitive}/`),
      );
      if (!records.length) throw new Error('AUTONOMOUS_PRIMITIVE_MISSING');
      // Built once for the whole primitive; the paint this one replaces is freed below.
      const previous = owned.get(primitive);
      const painted = hostPageSurface(material, false);
      owned.set(primitive, painted);
      wear(records, painted);
      if (previous) releasePaint(previous);
    },
    /** Each assigned mesh's records wear its surface as given, already the variant their
     *  geometry asks for (`wearSurface`, #847); copies refused. A paint this engine owns that no
     *  record wears any more is freed with its twin, as a repaint frees it. */
    wearSurface({ meshes }: SurfaceAssignment) {
      sceneChanged();
      const replaced = new Set<HostMaterials | undefined>();
      for (const [surface, records] of recordsBySurface(allPages, meshes)) {
        for (const rec of records) replaced.add(baseMaterials.get(rec));
        wear(records, surface as HostMaterial, () => surface as HostMaterial);
      }
      for (const [primitive, painted] of owned)
        if (replaced.has(painted) && !allPages.some((rec) => baseMaterials.get(rec) === painted)) {
          owned.delete(primitive);
          releasePaint(painted);
        }
    },
  };
}
