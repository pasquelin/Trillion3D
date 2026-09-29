import type { MeasuredWorld } from '../session/explorer.ts';
import type { SceneMaterialPatch } from '../api/materialApi.ts';

/** The public world's page-material methods delegate to its current drawing session. */
export function worldMaterialMethods(session: () => MeasuredWorld | null, invalidate: () => void) {
  const drawn = () => {
    const current = session();
    if (!current) throw new Error('This world draws nothing yet: add a model first');
    return current;
  };
  const createMaterial: MeasuredWorld['createMaterial'] = ((props = {}) =>
    drawn().createMaterial(props)) as MeasuredWorld['createMaterial'];
  return {
    /** Current imported materials, followed by page-created materials. */
    materials: () => drawn().materials(),
    /** One material by its listed ID. */
    material: (id: string) => drawn().material(id),
    /** Source-file values, before any page edits. */
    importedMaterials: () => drawn().importedMaterials(),
    /** Changes an imported or created material on the next frame. */
    setMaterial(id: string, patch: SceneMaterialPatch) {
      const taken = drawn().setMaterial(id, patch);
      invalidate();
      return taken;
    },
    /** Creates a page-owned material; with a bitmap map, await admission before assignment. */
    createMaterial,
    /** Releases an unused created material; reassign its drawables first. */
    dropMaterial: (id: string) => drawn().dropMaterial(id),
    /** Runtime map bytes held or pending, under the fixed 64 MiB ceiling. */
    materialMapBytes: () => drawn().materialMapBytes(),
    /** Gives a compiled `mesh/primitive` the page's created material. */
    assignMaterial(primitive: string, id: string) {
      const taken = drawn().assignMaterial(primitive, id);
      invalidate();
      return taken;
    },
  };
}
