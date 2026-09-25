import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import type {
  CookedInstance,
  CookedPhysics,
  CookedTile,
} from '../../../sdk-core/src/physics/index.ts';
import { boxTransform } from '../../../sdk-core/src/math/primitives/box.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';
import { resolveCameraWorld } from '../camera/world.ts';

/** A compiled model as the streamer reads it (`LoadedModel`): where its files are. */
export type Model = Object3D & { isLoadedModel: true; record: { base: string } };
export const isModel = (node: Object3D): node is Model =>
  (node as { isLoadedModel?: boolean }).isLoadedModel === true;

/** Where a node of the model places what was cooked for it, in the model's frame. */
type CookedPlacement = Pick<CookedInstance, 'position' | 'rotation' | 'scale'>;

/** One cooked tile placed by one instance: its world box, and whether its body is in. */
export interface Placed {
  model: Model;
  instance: CookedInstance;
  tile: CookedTile;
  /** The glTF material of every triangle the tile holds, `-1` for none: its collider's. */
  material: number;
  /** Its world box, six values (`boxTransform`). */
  box: Float64Array;
  /** The body's engine id once resident, -1 while out. */
  id: number;
  /** Its bytes are on their way. */
  loading: boolean;
}

/** Seconds of travel a moving body's tiles are loaded ahead of it. */
const LOOKAHEAD_S = 1;

const place = new Matrix4(),
  local = new Matrix4(),
  position = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  bounds = new Box3();

/** The bytes of a cooked object beside `model`'s manifest — a tile, a soft body's settings —
 *  refused by `what` and its url when the fetch fails. */
export async function cookedBytes(model: Model, url: string, what: string) {
  const response = await fetch(new URL(url, model.record.base).href);
  if (!response.ok) throw new EngineError('PHYSICS_FAILED', `${what} ${url}: ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Each cooked tile of `cooked` placed by each instance of its collider in `model`, out. */
export function placedOf(model: Model, cooked: CookedPhysics): Placed[] {
  return cooked.instances.flatMap((instance) => {
    const { tiles, material } = cooked.colliders[instance.collider];
    return tiles.map((tile) => {
      const p: Placed = {
        model,
        instance,
        tile,
        material: material ?? -1,
        box: new Float64Array(6),
        id: -1,
        loading: false,
      };
      locate(p);
      return p;
    });
  });
}

/** A tile's — or a cooked soft body's — world pose: its model's world matrix times its placement,
 *  as position, turn, scale (scratch shared by every caller: read them at once). */
export function tilePose(p: { model: Model; instance: CookedPlacement }) {
  const { position: t, rotation: r, scale: s } = p.instance;
  position.set(t[0], t[1], t[2]);
  local.compose(position, turn.set(r[0], r[1], r[2], r[3]), size.set(s[0], s[1], s[2]));
  place
    .multiplyMatrices(resolveCameraWorld(p.model).matrixWorld, local)
    .decompose(position, turn, size);
  return { place, position: position.elements, quaternion: turn.elements, scale: size };
}

/** Places a tile's world box from its pose. */
export function locate(p: Placed) {
  boxTransform(p.box, 0, p.tile.bounds, 0, tilePose(p).place.elements);
}

/**
 * Where each moving body wants ground: `x, y, z, reach` per dynamic body, the reach its half size
 * plus the way it travels in `LOOKAHEAD_S` seconds.
 */
export function moversOf(meshes: readonly (Bodied | null)[]) {
  const out: number[] = [];
  for (const mesh of meshes) {
    if (!mesh || mesh.physics.type !== 'dynamic') continue;
    const box = mesh.localBounds();
    bounds.makeEmpty();
    if (box) bounds.copy(box).applyMatrix4(mesh.matrixWorld);
    const half = bounds.isEmpty() ? 0 : bounds.getSize(size).length() / 2;
    const v = mesh.physics.velocity;
    out.push(mesh.position.x, mesh.position.y, mesh.position.z);
    out.push(half + Math.hypot(v.x, v.y, v.z) * LOOKAHEAD_S);
  }
  return out;
}
