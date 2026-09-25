import type { Fog } from '../core/sceneFog.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/index.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { RECIPES } from '../../../../sdk-core/src/world/geometry/recipes.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Mesh, type Primitive } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Sprite } from '../../../../sdk-core/src/world/object/sprite.ts';
import { Light } from '../../../../sdk-core/src/world/light/light.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { isHelper } from '../helper/mark.ts';
import {
  assertSavedScene,
  notSavable,
  type SavedCamera,
  type SavedGeometry,
  type SavedNode,
} from './format.ts';

/** What reading a scene needs of the scene it fills: its root, its load door, its surroundings. */
type Target = Object3D & {
  background: unknown;
  fog: Fog | null;
  load(url: string): Promise<Object3D>;
};

/** The typed arrays a saved attribute may name: its values come back in the type they had. */
const TYPED: Record<string, new (values: number[]) => ArrayLike<number>> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

/** A shape again: its family call, or its vertices. */
function readGeometry(saved: SavedGeometry): Geometry {
  if (saved.recipe) {
    const build = (RECIPES as Record<string, (...args: unknown[]) => Geometry>)[saved.recipe.type];
    if (!build) notSavable(`a shape built by ${saved.recipe.type}`);
    return build(...saved.recipe.args);
  }
  const g = new Geometry();
  g._owner = saved.owner ?? 'world';
  for (const [name, a] of Object.entries(saved.attributes ?? {})) {
    const Typed = TYPED[a.type] ?? Float32Array;
    g.setAttribute(
      name,
      new BufferAttribute(new Typed(a.array) as never, a.itemSize, a.normalized),
    );
  }
  if (saved.index) g.setIndex(saved.index);
  for (const group of saved.groups ?? []) g.addGroup(group.start, group.count, group.materialIndex);
  return g;
}

/** Puts a camera back where it was saved; a camera of another projection keeps its own. */
function readCamera(saved: SavedCamera, camera: Camera) {
  camera.position.fromArray(saved.position);
  camera.quaternion.fromArray(saved.quaternion);
  if (saved.projection === camera.projection) Object.assign(camera, saved.optics);
}

/**
 * Fills `scene` with a saved scene (`format.ts`) in place of what it held, its `helper` marks
 * excepted: every node, shape, material and light built again through the families, each loaded
 * model loaded again from its address, siblings in their order. `camera`, when given, is put where
 * the scene was saved from. Another format or version, or a model that cannot be loaded, is
 * refused by name and the scene is left as it was.
 */
export async function readScene(scene: Target, json: unknown, camera?: Camera) {
  assertSavedScene(json);
  const geometries = json.geometries.map(readGeometry);
  const materials = json.materials.map((m) => new Material(m.kind, m.parameters));
  /** Every model load started: `load` adds each model to the scene as it arrives. */
  const loads: Promise<Object3D>[] = [];
  const node = async (saved: SavedNode): Promise<Object3D> => {
    let o: Object3D;
    if (saved.mesh) {
      const worn = saved.mesh.material;
      const matter = Array.isArray(worn) ? worn.map((i) => materials[i]) : materials[worn];
      const { geometry, primitive, center } = saved.mesh;
      if (primitive === 'sprite') {
        const sprite = new Sprite(matter as Material);
        sprite.geometry = geometries[geometry];
        if (center) sprite.center.set(center[0], center[1]);
        o = sprite;
      } else o = new Mesh(geometries[geometry], matter, primitive as Primitive);
    } else if (saved.light) {
      const { kind, color, groundColor, values, target, sh } = saved.light;
      o = new Light(kind, { ...values, color, groundColor, target, sh: sh ?? undefined });
    } else if (saved.model) {
      const load = scene.load(saved.model.url);
      loads.push(load);
      o = await load;
    } else o = saved.kind === 'group' ? new Group() : new Object3D();
    o.name = saved.name;
    o.position.fromArray(saved.position);
    o.quaternion.fromArray(saved.quaternion);
    o.scale.fromArray(saved.scale);
    o.visible = saved.visible;
    o.castShadow = saved.castShadow;
    o.receiveShadow = saved.receiveShadow;
    o.renderOrder = saved.renderOrder;
    o.userData = saved.userData;
    const children = await Promise.all(saved.children.map(node));
    if (children.length) o.add(...children);
    return o;
  };
  // The `helper` marks are how the scene is worked on: they stay, as `toJSON` left them out.
  const before = scene.children.filter((child) => !isHelper(child));
  let children: Object3D[];
  try {
    children = await Promise.all(json.children.map(node));
  } catch (error) {
    // A model that could not be read leaves the scene as it was: every load still running is
    // waited for — one may start another under it — and every model that arrived goes again.
    for (let settled = -1; settled !== loads.length;) {
      settled = loads.length;
      await Promise.allSettled(loads);
    }
    for (const load of await Promise.allSettled(loads))
      if (load.status === 'fulfilled') load.value.removeFromParent();
    throw error;
  }
  if (before.length) scene.remove(...before);
  if (children.length) scene.add(...children);
  scene.background = json.background && new Color().setRGB(...json.background);
  scene.fog = json.fog && { ...json.fog, color: new Color().setRGB(...json.fog.color) };
  if (camera && json.camera) readCamera(json.camera, camera);
}
