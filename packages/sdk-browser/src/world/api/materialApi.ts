import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { runtimeMaterials } from './runtimeMaterials.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import type { GraphTexture } from '../../host/graph/texture.ts';
import { tableRankOf } from '../../host/prepared/materials.ts';
import { materialTextures, meshes } from '../../scene/meshes.ts';
import type { BackendContext } from '../../backend/types.ts';
import { primitiveName } from '../../scene/primitiveLookup.ts';
import type { HostMesh } from '../../host/resources.ts';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts';
import { alphaMoves } from '../../placement/backendSceneUpdates.ts';
import {
  invalid,
  read,
  validate,
  write,
  type SceneMaterial,
  type SceneMaterialPatch,
} from './materialValues.ts';
import { materialEngines } from './materialEngines.ts';
import { assignment, PLAIN } from './createdMaterials.ts';

export type { SceneMaterial, SceneMaterialPatch } from './materialValues.ts';
export { RUNTIME_MATERIAL_CEILING, type CreatedMaterial } from './createdMaterials.ts';

type Inputs = {
  check: () => void;
  /** The scene the session draws: its prepared surfaces are the scene's materials. */
  source: Object3D;
  /** The source meshes and the manifest primitive each draws: a drawable is named by it. */
  associations: BackendContext['associations'];
  backends: RenderBackend[];
  active: () => RenderBackend;
  onDispose?: (release: () => void) => void;
};

/**
 * Public API of the scene's materials, the shape of the light API (`lightApi.ts`). A material is
 * one entry of the cache's material table, keyed by its rank there, never by a primitive: setting
 * it writes every surface the scene built from that entry — one per geometry variant — in place,
 * and the active engine reads them again at the next frame (`refreshMaterials`), no second upload
 * path and no new GPU memory. Moved to another draw class, opaque, masked or blended, its
 * drawables go where the open would put them (#846); an engine that lays that class out at open
 * refuses it by name (`MATERIAL_CLASS_CHANGE`), before any write. A page creates materials too
 * (#847), each a host surface of its own, set and read as a scene material is, that a drawable
 * is given to wear (`assignMaterial`).
 */
export function createExplorerMaterialApi(inputs: Inputs) {
  const { check, source, associations, backends, active } = inputs;
  /** The materials the page created, by id no table rank takes, each its surface per geometry
   *  variant a drawable asked (`PLAIN` first): a write reaches them all (`preparedMaterials`). */
  const runtime = runtimeMaterials(check, backends),
    { created } = runtime;
  inputs.onDispose?.(runtime.dispose);
  /** The created material each assigned mesh wears: a change to one worn reaches the engines. */
  const wearing = new Map<HostMesh, string>();
  /** Built at the first call, not at open: most pages never ask. Before any write, so the values
   *  it keeps as imported are the file's. */
  let held: ReturnType<typeof index> | undefined;
  const index = () => {
    const worn = new Map<number, Set<GraphSurface>>();
    const wearers = new Map<GraphTexture, Set<number>>();
    // The drawables a created material is assigned to, by the primitive name a page gives.
    const drawables = new Map<string, Set<HostMesh>>();
    for (const mesh of meshes(source)) {
      const name = primitiveName(associations.get(mesh));
      if (name) drawables.set(name, (drawables.get(name) ?? new Set()).add(mesh));
      for (const surface of [mesh.material as GraphSurface | GraphSurface[]].flat()) {
        const rank = tableRankOf(surface);
        if (rank === undefined) continue;
        worn.set(rank, (worn.get(rank) ?? new Set()).add(surface));
        for (const texture of materialTextures(surface))
          wearers.set(texture, (wearers.get(texture) ?? new Set()).add(rank));
      }
    }
    const surfaces = new Map([...worn].map(([rank, set]) => [rank, [...set]]));
    const ranks = [...surfaces.keys()].sort((a, b) => a - b);
    // What the scene file carried: a page resets a material from it.
    const imported = ranks.map((rank) => read(rank, surfaces.get(rank)![0]));
    return { surfaces, wearers, ranks, imported, drawables };
  };
  const scene = () => (held ??= index());
  const { refuseClass, repaints, refreshed } = materialEngines(backends, active);
  const required = (id: string) => {
    const made = created.get(id);
    if (made) return { rank: id, worn: [...made.values()] };
    const rank = Number(id);
    // An id is the rank as listed: '', ' 1' or '1.0' would name a rank by accident.
    const worn = String(rank) === id ? scene().surfaces.get(rank) : undefined;
    if (!worn) throw new EngineError('UNKNOWN_MATERIAL', `the scene has no material ${id}`, { id });
    return { rank, worn };
  };
  return {
    /** The scene's materials as they are now, in table order; each a detached copy. */
    materials(): SceneMaterial[] {
      check();
      const { ranks, surfaces } = scene();
      const listed = ranks.map((rank) => read(rank, surfaces.get(rank)![0]));
      for (const [id, variants] of created) listed.push(read(id, variants.get(PLAIN)!));
      return listed;
    },
    /** One material as it is now, a detached copy; an unknown id is refused by name. */
    material(id: string): SceneMaterial {
      check();
      const { rank, worn } = required(id);
      return read(rank, worn[0]);
    },
    /** The materials as the scene file carried them, whatever was set since: detached copies. */
    importedMaterials(): SceneMaterial[] {
      check();
      return structuredClone(scene().imported);
    },
    /**
     * Sets a material's values live, from the next frame; every check runs before any write.
     * False when an engine of the session cannot take it in place, and only a new session will.
     */
    setMaterial(id: string, patch: SceneMaterialPatch) {
      check();
      const { rank, worn } = required(id);
      validate(rank, patch);
      const from = alphaModeOf(worn[0]),
        mode = patch.alphaMode ?? from;
      // A masked material cut at zero is drawn as an opaque one.
      const to = mode === 'mask' && patch.alphaCutoff === 0 ? 'opaque' : mode;
      const alpha = alphaMoves(from, to, patch.alphaCutoff !== undefined)
        ? { surfaces: worn, from, to }
        : undefined;
      if (patch.tiling) {
        const textures = worn.flatMap((surface) => [...materialTextures(surface)]);
        if (!textures.length) throw invalid(rank, 'tiling', patch.tiling);
        const { wearers } = scene();
        const shared = textures.find((texture) => (wearers.get(texture)?.size ?? 1) > 1);
        if (shared)
          throw new EngineError(
            'MATERIAL_TEXTURE_SHARED',
            `material ${id} shares its map ${shared.name} with another material: tiling it would tile both`,
            { id, texture: shared.name, materials: [...wearers.get(shared)!].map(String) },
          );
      }
      // A created material no drawable wears yet is written alone: no engine draws it.
      if (created.has(id) && ![...wearing.values()].includes(id)) {
        for (const surface of worn) write(surface, patch, alpha?.to);
        return true;
      }
      if (alpha && to !== from) refuseClass(id, alpha);
      repaints(id);
      for (const surface of worn) write(surface, patch, alpha?.to);
      return refreshed(alpha);
    },
    createMaterial: runtime.createMaterial,
    /** Decoded map bytes admitted or pending, bounded by RUNTIME_MAP_BYTES_CEILING. */
    materialMapBytes: () => (check(), runtime.mapBytes()),
    /** Drop an unused runtime material; reassign its drawables before dropping it. */
    dropMaterial(id: string) {
      check();
      if ([...wearing.values()].includes(id))
        throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'material is still assigned', { id });
      runtime.drop(id);
    },
    /** Drawable `primitive` (`mesh/primitive`, as the manifest names it) wears created material
     *  `id` from the next frame, in its geometry's variant and its alpha mode's draw class (#846);
     *  refused by name before any write. False when an engine only draws it in a new session. */
    assignMaterial(primitive: string, id: string) {
      check();
      const made = created.get(id);
      if (!made)
        throw new EngineError('UNKNOWN_MATERIAL', `the page created no material ${id}`, { id });
      // The table's wearers are indexed as imported, before a mesh wears another.
      const drawn = scene().drawables.get(primitive);
      if (!drawn)
        throw new EngineError('UNKNOWN_SCENE_NODE', `the scene draws no primitive ${primitive}`, {
          primitive,
        });
      // A variant built for this drawable is kept only once nothing refused it.
      const variants = new Map(made);
      const alpha = assignment(variants, drawn);
      refuseClass(id, alpha);
      repaints(id);
      created.set(id, variants);
      for (const mesh of drawn) wearing.set(mesh, id);
      for (const [mesh, surface] of alpha.meshes) mesh.material = surface;
      for (const backend of backends) backend.wearSurface?.(alpha);
      return refreshed(alpha) && backends.every((backend) => !!backend.wearSurface);
    },
  };
}
