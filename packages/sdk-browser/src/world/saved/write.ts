import { MATERIAL_BOOKKEEPING } from '../../../../sdk-core/src/world/material/material.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type { LoadedModel } from '../core/loadedModel.ts';
import { isHelper } from '../helper/mark.ts';
import {
  notSavable,
  SCENE_FORMAT,
  SCENE_FORMAT_VERSION,
  type SavedCamera,
  type SavedGeometry,
  type SavedMaterial,
  type SavedNode,
  type SavedScene,
} from './format.ts';

type SceneLike = Object3D & {
  background: unknown;
  environment: unknown;
  fog: { color: Color; near: number; far: number } | null;
};

/** A linear colour, or a point a light aims at. */
type Triple = [number, number, number];
const rgb = (c: Color): Triple => [c.r, c.g, c.b];
/** A plain copy of JSON-shaped data: what the page stored in `userData` or a parameter; a
 *  `null` stays `null` (a cleared parameter), `undefined` stays unset. */
const plain = (value: unknown) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** The shape: its family call while it still holds, its vertices otherwise. */
function saveGeometry(g: Geometry): SavedGeometry {
  if (g.recipe) return { recipe: plain(g.recipe) };
  const attributes: SavedGeometry['attributes'] = {};
  for (const [name, a] of Object.entries(g.attributes))
    attributes[name] = {
      itemSize: a.itemSize,
      array: Array.from(a.array),
      type: a.array.constructor.name,
      normalized: a.normalized,
    };
  const index = g.index ? Array.from(g.index.array) : undefined;
  return { attributes, index, groups: g.groups.map((group) => ({ ...group })) };
}

/** The matter: its kind and each parameter; a texture or a shader cannot be stored. */
function saveMaterial(m: Material): SavedMaterial {
  if (m.kind === 'shader') notSavable('a shader material');
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(m)) {
    if (name === 'kind' || MATERIAL_BOOKKEEPING.has(name)) continue;
    const shaped = value as { isColor?: boolean; isTexture?: boolean } | null;
    if (shaped?.isTexture) notSavable('a texture', { parameter: name });
    parameters[name] = shaped?.isColor ? rgb(value as Color) : plain(value);
  }
  return { kind: m.kind, parameters };
}

/** The camera's pose and optics. */
function saveCamera(camera: Camera): SavedCamera {
  return {
    projection: camera.projection,
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    optics: { ...camera._optics },
  };
}

/**
 * A scene as plain JSON (`format.ts`): its hierarchy and poses, each shape by the call that built
 * it, each material by its parameters, lights, the background and fog, a loaded model by its
 * manifest address, and `camera` when one is given. Shapes and materials worn by several meshes
 * are stored once. `helper` marks are left out: they are how a scene is worked on, not what it is.
 */
export function saveScene(scene: SceneLike, camera?: Camera): SavedScene {
  const background = scene.background as Color | null;
  if (scene.environment) notSavable('a picture environment');
  const geometries = new Map<Geometry, number>(),
    materials = new Map<Material, number>();
  const rank = <T>(table: Map<T, number>, item: T) => {
    if (!table.has(item)) table.set(item, table.size);
    return table.get(item)!;
  };
  const node = (o: Object3D): SavedNode => {
    const mesh = o as Mesh,
      lamp = o as Light,
      model = o as LoadedModel;
    const saved: SavedNode = {
      kind: mesh.isMesh
        ? 'mesh'
        : lamp.isLight
          ? 'light'
          : model.isLoadedModel
            ? 'model'
            : 'object',
      name: o.name,
      position: o.position.toArray(),
      quaternion: o.quaternion.toArray(),
      scale: o.scale.toArray(),
      visible: o.visible,
      castShadow: o.castShadow,
      receiveShadow: o.receiveShadow,
      renderOrder: o.renderOrder,
      userData: plain(o.userData),
      // What a model's file carried comes back with the model; what the page placed under it
      // is saved like any child.
      children: o.children
        .filter((c) => !isHelper(c) && !(model.isLoadedModel && model._fromFile(c)))
        .map(node),
    };
    if ((o as { isGroup?: boolean }).isGroup) saved.kind = 'group';
    if (mesh.isMesh) {
      const worn = mesh.material;
      saved.mesh = {
        geometry: rank(geometries, mesh.geometry),
        material: Array.isArray(worn) ? worn.map((m) => rank(materials, m)) : rank(materials, worn),
        primitive: mesh.primitive,
      };
    }
    if (lamp.isLight)
      saved.light = {
        kind: lamp.kind,
        color: rgb(lamp.color),
        groundColor: rgb(lamp.groundColor),
        values: { ...lamp._values },
        target: lamp.target.position.toArray() as Triple,
        sh: lamp.sh ? [...lamp.sh] : null,
      };
    if (model.isLoadedModel) saved.model = { url: model.record.manifestUrl };
    return saved;
  };
  const children = scene.children.filter((c) => !isHelper(c)).map(node);
  const fog = scene.fog;
  return {
    format: SCENE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    background: background && rgb(background),
    fog: fog && { color: rgb(fog.color), near: fog.near, far: fog.far },
    camera: camera ? saveCamera(camera) : null,
    geometries: [...geometries.keys()].map(saveGeometry),
    materials: [...materials.keys()].map(saveMaterial),
    children,
  };
}
